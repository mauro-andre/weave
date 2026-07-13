/**
 * Driver + connection (Phase 1c).
 *
 * `weave()` builds a {@link Weave} instance around a postgres.js client and a
 * set of registered entities. It exposes:
 *
 *   - `sql`         — the raw postgres.js handle (escape hatch).
 *   - `transaction` — run work inside a single ACID transaction.
 *   - `sync()`      — the embryo of the eventual diff-based migrator: creates
 *                     tables that don't exist yet. It does NOT alter existing
 *                     tables (no ADD COLUMN / ADD INDEX) — that's the real diff,
 *                     Phase 6. A transaction-scoped advisory lock serializes
 *                     concurrent boots (multi-instance safe).
 */

import process from "node:process";
import postgres from "postgres";
import { collectTables } from "../ddl/emit.js";
import {
  diffSchema,
  emitChanges,
  type ActualSchema,
  type ChangeSet,
} from "../ddl/diff.js";
import { type Entity, type ShapeRecord, type InferEntity, type InferRead, type InferInsert, type InferSelect, type ExpandInput, type SelectInput, type Projection, type AnyProjection, type WhereInput, type OrderByInput } from "@mauroandre/weave-core";
import {
  compileFind,
  compileCount,
  type FindOptions,
  type SelectMap,
} from "../query/read.js";
import { rehydrate } from "../query/rehydrate.js";
import { shred, type Executor } from "../query/write.js";

type Sql = postgres.Sql;
type TransactionSql = postgres.TransactionSql;
type AnyEntity = Entity<string, ShapeRecord>;

/**
 * Um write escopado produziria uma linha FORA do filtro do scope (o "WITH CHECK" do RLS):
 * criar/mover uma linha pra outro tenant. Lançado DENTRO da transação → rollback; o caller
 * (handler) mapeia pra 403. Cobre create e update (ambos passam pelo `save`/upsert).
 */
export class WithCheckError extends Error {
  constructor(message = "weave: write violates the active scope's row filter.") {
    super(message);
    this.name = "WithCheckError";
  }
}

/** Arbitrary constant keying the advisory lock that serializes `sync()`. */
const SYNC_LOCK_KEY = 0x7ea7e_0001;

/** Narrow a find/paginate source to a {@link Projection}. */
function isProjectionSource(
  source: Entity<string, ShapeRecord> | AnyProjection,
): source is AnyProjection {
  return "kind" in source && source.kind === "projection";
}

export interface WeaveOptions {
  /** Connection string. Falls back to `process.env.DATABASE_URL`. */
  url?: string;
  /** An existing postgres.js client to reuse instead of creating one. */
  client?: Sql;
  /** Entities to manage. Keys are labels; values are `defineEntity(...)` results. */
  entities?: Record<string, AnyEntity>;
}

/** A page of results (zodmongo ergonomics). */
export interface Page<T> {
  docs: T[];
  /** Total rows matching the filter, ignoring pagination. */
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

/** Outcome of a {@link Weave.sync} call (additive changes applied). */
export interface SyncResult {
  /** Tables created this run. */
  created: string[];
  /** Columns added to existing tables (`table.column`). */
  columnsAdded: string[];
  /** Indexes created on existing tables. */
  indexesAdded: string[];
  /** Drift detected but not applied (destructive/altering); see {@link Weave.diff}. */
  warnings: string[];
}

export class Weave {
  /** Raw postgres.js handle. Escape hatch for advanced/internal use. */
  readonly sql: Sql;
  private readonly entities: AnyEntity[];
  /** Whether this instance created `sql` (and so should close it). */
  private readonly ownsClient: boolean;

  constructor(options: WeaveOptions = {}) {
    if (options.client) {
      this.sql = options.client;
      this.ownsClient = false;
    } else {
      const url = options.url ?? process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          "weave: no connection. Pass `url`, `client`, or set DATABASE_URL.",
        );
      }
      this.sql = postgres(url);
      this.ownsClient = true;
    }
    this.entities = options.entities ? Object.values(options.entities) : [];
  }

  /** Run `fn` inside a single transaction; commits on resolve, rolls back on throw. */
  transaction<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(fn) as Promise<T>;
  }

  /**
   * The desired schema across all entities. Sem ordenação: as FKs saem como
   * `ALTER … ADD CONSTRAINT` por último (ver `emitChanges`), então a ordem de criação
   * de tabela é irrelevante — ciclo mútuo e self-ref inclusos.
   */
  private desiredSpecs() {
    return this.entities.flatMap((entity) => collectTables(entity));
  }

  /** Introspect the live `public` schema (tables, columns, indexes). */
  private async introspect(q: Sql | TransactionSql): Promise<ActualSchema> {
    const cols = await q<
      {
        table_name: string;
        column_name: string;
        udt_name: string;
        data_type: string;
        is_nullable: string;
      }[]
    >`
      select table_name, column_name, udt_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
    `;
    const idx = await q<{ tablename: string; indexname: string }[]>`
      select tablename, indexname from pg_indexes where schemaname = 'public'
    `;
    // Colunas com FK (constraint já existente) — pra não re-adicionar e pra reconciliar
    // FKs adiadas de ciclo. Uma linha por (tabela, coluna) de cada constraint FOREIGN KEY.
    const fks = await q<{ table_name: string; column_name: string }[]>`
      select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    `;

    const schema: ActualSchema = new Map();
    const table = (name: string) => {
      let t = schema.get(name);
      if (!t) {
        t = { name, columns: new Map(), indexes: new Set(), foreignKeys: new Set() };
        schema.set(name, t);
      }
      return t;
    };
    for (const c of cols) {
      const isArray = c.data_type === "ARRAY";
      table(c.table_name).columns.set(c.column_name, {
        name: c.column_name,
        udtName: isArray ? c.udt_name.replace(/^_/, "") : c.udt_name,
        isArray,
        notNull: c.is_nullable === "NO",
      });
    }
    for (const i of idx) table(i.tablename).indexes.add(i.indexname);
    for (const f of fks) table(f.table_name).foreignKeys.add(f.column_name);
    return schema;
  }

  /** Compute the diff between the registered shape and the live database. */
  async diff(): Promise<ChangeSet> {
    return diffSchema(this.desiredSpecs(), await this.introspect(this.sql));
  }

  /**
   * Generate the additive migration SQL (and any drift warnings) without
   * applying it — the reviewable artifact for production (apply is delegated).
   */
  async generate(): Promise<{ sql: string; warnings: string[] }> {
    const { statements, warnings } = emitChanges(await this.diff());
    return { sql: statements.join("\n\n"), warnings };
  }

  /**
   * Apply the **additive** diff (create tables, add columns/indexes) in one
   * transaction, behind an advisory lock. Destructive/altering drift is NOT
   * applied — it's returned in `warnings` (use {@link diff}/{@link generate}).
   */
  async sync(): Promise<SyncResult> {
    const created: string[] = [];
    const columnsAdded: string[] = [];
    const indexesAdded: string[] = [];
    let warnings: string[] = [];

    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;
      const changes = diffSchema(this.desiredSpecs(), await this.introspect(tx));
      warnings = changes.warnings;

      const { statements } = emitChanges(changes);
      for (const stmt of statements) await tx.unsafe(stmt);

      created.push(...changes.createTables.map((s) => s.name));
      columnsAdded.push(...changes.addColumns.map((c) => `${c.table}.${c.column.name}`));
      indexesAdded.push(...changes.addIndexes.map((i) => i.index.name));
    });

    return { created, columnsAdded, indexesAdded, warnings };
  }

  /**
   * Read entities as a nested object tree. `owned` relationships come back
   * automatically; types are rehydrated from the wire JSON.
   */
  /** Read through a named {@link Projection}: select is baked in, result pruned. */
  find<TName extends string, TShape extends ShapeRecord, S>(
    projection: Projection<Entity<TName, TShape>, S>,
    options?: {
      where?: WhereInput<Entity<TName, TShape>>;
      orderBy?: OrderByInput<Entity<TName, TShape>>;
      limit?: number;
      offset?: number;
    },
  ): Promise<InferSelect<Entity<TName, TShape>, S>[]>;
  /** Read entities as a nested object tree; `owned` automatic, `reference` via `expand`. */
  find<TName extends string, TShape extends ShapeRecord, X = {}, S = never>(
    entity: Entity<TName, TShape>,
    options?: {
      where?: WhereInput<Entity<TName, TShape>>;
      orderBy?: OrderByInput<Entity<TName, TShape>>;
      expand?: X & ExpandInput<Entity<TName, TShape>>;
      select?: S & SelectInput<Entity<TName, TShape>>;
      limit?: number;
      offset?: number;
    },
  ): Promise<
    ([S] extends [never]
      ? InferRead<Entity<TName, TShape>, X>
      : InferSelect<Entity<TName, TShape>, S>)[]
  >;
  async find(
    source: Entity<string, ShapeRecord> | AnyProjection,
    options: FindOptions<Entity<string, ShapeRecord>> = {},
  ): Promise<unknown[]> {
    const entity = isProjectionSource(source) ? source.entity : source;
    const merged: FindOptions<Entity<string, ShapeRecord>> = isProjectionSource(source)
      ? { ...options, select: source.select as SelectMap }
      : options;
    const { text, params } = compileFind(entity, merged);
    const rows = await this.sql.unsafe(text, params as never[]);
    return rows.map((row) =>
      rehydrate(entity.columns, (row as unknown as { data: Record<string, unknown> }).data),
    );
  }

  /** Count rows matching a filter. */
  async count<TName extends string, TShape extends ShapeRecord>(
    entity: Entity<TName, TShape>,
    options: { where?: WhereInput<Entity<TName, TShape>> } = {},
  ): Promise<number> {
    const { text, params } = compileCount(entity, options.where);
    const rows = await this.sql.unsafe(text, params as never[]);
    return (rows[0] as unknown as { n: number }).n;
  }

  /**
   * Paginated read. Returns the page plus totals, in `zodmongo` ergonomics:
   * `docs` / `docsQuantity` (total matching) / `pageQuantity` / `currentPage`.
   * `page` is 1-based.
   */
  /** Paginated read through a named {@link Projection}. */
  paginate<TName extends string, TShape extends ShapeRecord, S>(
    projection: Projection<Entity<TName, TShape>, S>,
    options?: {
      where?: WhereInput<Entity<TName, TShape>>;
      orderBy?: OrderByInput<Entity<TName, TShape>>;
      page?: number;
      perPage?: number;
    },
  ): Promise<Page<InferSelect<Entity<TName, TShape>, S>>>;
  /** Paginated read; `zodmongo` envelope: docs / docsQuantity / pageQuantity / currentPage. */
  paginate<TName extends string, TShape extends ShapeRecord, X = {}, S = never>(
    entity: Entity<TName, TShape>,
    options?: {
      where?: WhereInput<Entity<TName, TShape>>;
      orderBy?: OrderByInput<Entity<TName, TShape>>;
      expand?: X & ExpandInput<Entity<TName, TShape>>;
      select?: S & SelectInput<Entity<TName, TShape>>;
      page?: number;
      perPage?: number;
    },
  ): Promise<
    Page<
      [S] extends [never]
        ? InferRead<Entity<TName, TShape>, X>
        : InferSelect<Entity<TName, TShape>, S>
    >
  >;
  async paginate(
    source: Entity<string, ShapeRecord> | AnyProjection,
    options: FindOptions<Entity<string, ShapeRecord>> & { page?: number; perPage?: number } = {},
  ): Promise<Page<unknown>> {
    const entity = isProjectionSource(source) ? source.entity : source;
    const select: SelectMap | undefined = isProjectionSource(source)
      ? (source.select as SelectMap)
      : options.select;

    const page = Math.max(1, options.page ?? 1);
    const perPage = Math.max(1, options.perPage ?? 20);
    const docsQuantity = await this.count(
      entity,
      options.where !== undefined ? { where: options.where } : {},
    );

    const findOpts: FindOptions<Entity<string, ShapeRecord>> = {
      ...(options.where !== undefined ? { where: options.where } : {}),
      ...(options.orderBy !== undefined ? { orderBy: options.orderBy } : {}),
      ...(options.expand !== undefined ? { expand: options.expand } : {}),
      ...(select !== undefined ? { select } : {}),
      limit: perPage,
      offset: (page - 1) * perPage,
    };
    const { text, params } = compileFind(entity, findOpts);
    const rows = await this.sql.unsafe(text, params as never[]);
    const docs = rows.map((row) =>
      rehydrate(entity.columns, (row as unknown as { data: Record<string, unknown> }).data),
    );

    return {
      docs,
      docsQuantity,
      pageQuantity: Math.max(1, Math.ceil(docsQuantity / perPage)),
      currentPage: page,
    };
  }

  /**
   * Write an aggregate transactionally: shred the object into rows, upsert the
   * root, and replace its `owned` subtree. Returns the saved tree, re-read.
   */
  async save<TName extends string, TShape extends ShapeRecord>(
    entity: Entity<TName, TShape>,
    input: InferInsert<Entity<TName, TShape>>,
    check?: WhereInput<Entity<TName, TShape>>,
  ): Promise<InferEntity<Entity<TName, TShape>>> {
    const id = await this.transaction(async (tx) => {
      const newId = await shred(tx as unknown as Executor, entity, input as Record<string, unknown>);
      // WITH CHECK: a linha resultante (create OU update/upsert) tem que satisfazer o
      // filtro do scope — senão é write cross-tenant. Verifica DENTRO da txn → rollback.
      if (check) await this.assertWithCheck(tx, entity, newId, check, 1);
      return newId;
    });
    const [saved] = await this.find(entity, {
      where: { id } as WhereInput<Entity<TName, TShape>>,
    });
    return saved!;
  }

  /** Conta, na txn, quantas das linhas (`ids`) satisfazem `check`; ≠ esperado → viola o scope. */
  private async assertWithCheck<TName extends string, TShape extends ShapeRecord>(
    tx: TransactionSql,
    entity: Entity<TName, TShape>,
    ids: string | string[],
    check: WhereInput<Entity<TName, TShape>>,
    expected: number,
  ): Promise<void> {
    const idFilter = Array.isArray(ids) ? { id: { in: ids } } : { id: ids };
    const where = { and: [idFilter, check] } as unknown as WhereInput<Entity<TName, TShape>>;
    const { text, params } = compileCount(entity, where);
    const [row] = (await tx.unsafe(text, params as never[])) as unknown as { n: number }[];
    if (Number(row?.n ?? 0) !== expected) throw new WithCheckError();
  }

  /**
   * Insert many objects in ONE transaction (batch ingest). Shreds each input
   * (reusa toda a semântica do `save`: owned/refs/uuid), depois relê os ids e
   * devolve na ORDEM de entrada. Correto pra qualquer forma de entidade; um
   * fast-path de INSERT multi-linha (entidades planas) é otimização futura.
   */
  async createMany<TName extends string, TShape extends ShapeRecord>(
    entity: Entity<TName, TShape>,
    inputs: InferInsert<Entity<TName, TShape>>[],
    check?: WhereInput<Entity<TName, TShape>>,
  ): Promise<InferEntity<Entity<TName, TShape>>[]> {
    if (inputs.length === 0) return [];
    const ids = await this.transaction(async (tx) => {
      const out: string[] = [];
      for (const input of inputs) {
        out.push(await shred(tx as unknown as Executor, entity, input as Record<string, unknown>));
      }
      // WITH CHECK do lote: TODAS as linhas novas têm que satisfazer o filtro (senão rollback).
      if (check) await this.assertWithCheck(tx, entity, out, check, out.length);
      return out;
    });
    const found = (await this.find(entity, {
      where: { id: { in: ids } } as WhereInput<Entity<TName, TShape>>,
    })) as InferEntity<Entity<TName, TShape>>[];
    // `id IN (…)` não preserva ordem — reindexa pra devolver na ordem de entrada.
    const byId = new Map(found.map((r) => [(r as { id: string }).id, r]));
    return ids.map((id) => byId.get(id)!);
  }

  /** Close the underlying connection (only if this instance created it). */
  async close(): Promise<void> {
    if (this.ownsClient) await this.sql.end();
  }
}

/** Build a {@link Weave} instance. */
export function weave(options?: WeaveOptions): Weave {
  return new Weave(options);
}
