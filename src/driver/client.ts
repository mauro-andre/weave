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
import { collectTables, renderCreateTable, renderIndexes } from "../ddl/emit.js";
import type {
  Entity,
  ShapeRecord,
  InferEntity,
  InferRead,
  InferInsert,
  ExpandInput,
} from "../schema/entity.js";
import { compileFind, type FindOptions, type WhereInput } from "../query/read.js";
import { rehydrate } from "../query/rehydrate.js";
import { shred, type Executor } from "../query/write.js";

type Sql = postgres.Sql;
type TransactionSql = postgres.TransactionSql;
type AnyEntity = Entity<string, ShapeRecord>;

/** Arbitrary constant keying the advisory lock that serializes `sync()`. */
const SYNC_LOCK_KEY = 0x7ea7e_0001;

export interface WeaveOptions {
  /** Connection string. Falls back to `process.env.DATABASE_URL`. */
  url?: string;
  /** An existing postgres.js client to reuse instead of creating one. */
  client?: Sql;
  /** Entities to manage. Keys are labels; values are `defineEntity(...)` results. */
  entities?: Record<string, AnyEntity>;
}

/** Outcome of a {@link Weave.sync} call. */
export interface SyncResult {
  /** Tables created this run. */
  created: string[];
  /** Tables that already existed and were left untouched. */
  skipped: string[];
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
   * Create any registered table that doesn't exist yet, in one transaction.
   * Idempotent: existing tables are skipped (not altered). See class note.
   */
  async sync(): Promise<SyncResult> {
    const created: string[] = [];
    const skipped: string[] = [];

    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;

      const rows = await tx<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public'
      `;
      const existing = new Set(rows.map((r) => r.table_name));

      // Each entity expands to its full owned tree (parent-first).
      for (const entity of this.entities) {
        for (const spec of collectTables(entity)) {
          if (existing.has(spec.name)) {
            skipped.push(spec.name);
            continue;
          }
          await tx.unsafe(renderCreateTable(spec));
          for (const idx of renderIndexes(spec)) {
            await tx.unsafe(idx);
          }
          created.push(spec.name);
        }
      }
    });

    return { created, skipped };
  }

  /**
   * Read entities as a nested object tree. `owned` relationships come back
   * automatically; types are rehydrated from the wire JSON.
   */
  async find<TName extends string, TShape extends ShapeRecord, X = {}>(
    entity: Entity<TName, TShape>,
    options: {
      where?: WhereInput<Entity<TName, TShape>>;
      expand?: X & ExpandInput<Entity<TName, TShape>>;
    } = {},
  ): Promise<InferRead<Entity<TName, TShape>, X>[]> {
    const { text, params } = compileFind(
      entity,
      options as unknown as FindOptions<Entity<TName, TShape>>,
    );
    const rows = await this.sql.unsafe(text, params as never[]);
    return rows.map((row) =>
      rehydrate(entity.columns, (row as unknown as { data: Record<string, unknown> }).data),
    ) as InferRead<Entity<TName, TShape>, X>[];
  }

  /**
   * Write an aggregate transactionally: shred the object into rows, upsert the
   * root, and replace its `owned` subtree. Returns the saved tree, re-read.
   */
  async save<TName extends string, TShape extends ShapeRecord>(
    entity: Entity<TName, TShape>,
    input: InferInsert<Entity<TName, TShape>>,
  ): Promise<InferEntity<Entity<TName, TShape>>> {
    const id = await this.transaction((tx) =>
      shred(tx as unknown as Executor, entity, input as Record<string, unknown>),
    );
    const [saved] = await this.find(entity, {
      where: { id } as WhereInput<Entity<TName, TShape>>,
    });
    return saved!;
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
