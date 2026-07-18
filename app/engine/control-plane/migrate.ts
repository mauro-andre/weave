// Aplicação do plano de edição (estágio 3). O engine só faz aditivo (create
// table/column/index); todo ALTER de coluna existente (rename, drop, not null,
// unique, default, drop index) é emitido aqui, cercando o aditivo do engine,
// tudo numa transação. O usuário nunca vê uma linha desse SQL.

import type postgres from "postgres";
import { weave } from "../index.js";
import { emitChanges } from "../ddl/diff.js";
import { camelToSnake, ownedChildTable, joinTableName, indexName, compositeIndexName, slug, type Entity, type ShapeRecord, type EntityDiff, type FieldChange, type ColumnIR, type EntityIR } from "@mauroandre/weave-core";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
type AnyEntity = Entity<string, ShapeRecord>;

// ── Sondagem: refina o plano estrutural contra o dado vivo ─────────────────────
// Vazio→auto, duplicata→blocked, etc. Mudanças em campos aninhados (dentro de
// um owned) são adiadas — só o topo é editável na v1. A sonda roda ANTES da
// migração, então enxerga o banco como o IR ANTERIOR o descreve: nomes físicos
// são resolvidos por field-id contra `prev` (à prova de rename) e colunas que
// nascem neste plano são tratadas pelo valor que terão (NULL ou constante).
export async function probePlan(
  sql: Sql,
  prev: EntityIR | null,
  next: EntityIR,
  plan: EntityDiff,
  fill: Record<string, unknown> = {},
): Promise<EntityDiff> {
  if (plan.isNew || !prev) return plan;
  const changes: FieldChange[] = [];
  for (const c of plan.changes) changes.push(await probeChange(sql, prev, next, plan.changes, c, fill));
  return { ...plan, changes };
}

async function probeChange(
  sql: Sql,
  prev: EntityIR,
  next: EntityIR,
  all: FieldChange[],
  c: FieldChange,
  fill: Record<string, unknown>,
): Promise<FieldChange> {
  if (c.path.includes(".") && c.op !== "addField") {
    return blocked(c, "Editing fields inside a list isn't supported yet.");
  }
  const table = slug(next.name);
  const col = prevColumnName(prev, next, c.path) ?? camelToSnake(c.path);

  if (c.op === "addUnique") {
    return (await hasDuplicates(sql, table, col)) ? c : { ...c, risk: "auto" };
  }
  if (c.op === "addCompositeUnique") {
    const probeCols: string[] = [];
    for (const field of c.columns ?? []) {
      const existing = prevColumnName(prev, next, field);
      if (existing) {
        // Vira required com fill neste plano: os NULLs atuais viram a constante
        // do backfill — sonda o valor que a coluna terá DEPOIS da migração.
        const mr = all.find((ch) => ch.op === "makeRequired" && ch.path === field);
        const f = mr ? fill[field] : undefined;
        probeCols.push(f !== undefined ? `COALESCE(${existing}, ${literal(f)})` : existing);
        continue;
      }
      // Campo NOVO neste plano: o valor que ele terá nas linhas existentes decide.
      // Fill explícito (reference/escalar required) ou default estático → constante,
      // não afeta o agrupamento; sem nenhum dos dois nasce NULL em todas as linhas →
      // pela semântica NULL-distinto do PG, duplicata é impossível.
      const node = next.fields[field];
      const d = fill[field] ?? (node?.kind === "column" ? node.default : undefined);
      if (d === undefined || d === null) return { ...c, risk: "auto" };
    }
    if (probeCols.length === 0) {
      // Grupo todo de colunas novas constantes: qualquer 2+ linhas colidem.
      return (await count(sql, table)) > 1 ? c : { ...c, risk: "auto" };
    }
    return (await hasDuplicatesComposite(sql, table, probeCols)) ? c : { ...c, risk: "auto" };
  }
  if (c.op === "makeRequired") {
    if ((await count(sql, table, `${col} IS NULL`)) === 0) return { ...c, risk: "auto" };
    const node = next.fields[c.path];
    if (node?.kind === "column" && node.unique) {
      return blocked(c, "Each empty record needs its own value (unique field).");
    }
    return c; // needsValue
  }
  if (c.op === "addField" && c.risk === "needsValue") {
    if ((await count(sql, table)) === 0) return { ...c, risk: "auto" };
    return c; // 🟡 — o gate exige fill; o backfill uniforme resolve na aplicação
  }
  return c;
}

// ── Aplicação transacional ─────────────────────────────────────────────────────
export interface MigrationArgs {
  prev: EntityIR;
  next: EntityIR;
  /** Conjunto de entidades do engine (todas, com `next` substituída) p/ o aditivo. */
  entities: Record<string, AnyEntity>;
  /** Mudanças já sondadas e liberadas (sem blocked, confirmadas, com valores). */
  changes: FieldChange[];
  fill: Record<string, unknown>;
}

export async function applyMigration(tx: Tx, args: MigrationArgs): Promise<void> {
  const { next } = args;

  // 1. Renames primeiro, pra o aditivo enxergar a coluna já com o nome novo.
  for (const c of args.changes) {
    if (c.op === "renameField" && c.from) {
      await tx.unsafe(
        `ALTER TABLE ${slug(next.name)} RENAME COLUMN ${camelToSnake(c.from)} TO ${camelToSnake(c.path)}`,
      );
    }
  }

  // 2. Aditivo via engine, na MESMA transação (create table/column/index).
  const w = weave({ client: tx as unknown as Sql, entities: args.entities });
  const { statements } = emitChanges(await w.diff());
  for (const stmt of statements) await tx.unsafe(stmt);

  // 3. ALTERs de coluna existente que o engine não faz.
  for (const c of args.changes) await applyAlter(tx, args, c);
}

async function applyAlter(tx: Tx, args: MigrationArgs, c: FieldChange): Promise<void> {
  const { prev, next, fill } = args;
  const table = slug(next.name);
  const col = nextColumnName(next, c.path);

  switch (c.op) {
    case "addField": {
      // Com fill: a coluna entrou NULLABLE no aditivo (ver softenNewRequired) —
      // aqui acontece o backfill uniforme e só depois o SET NOT NULL.
      const v = fill[c.path];
      if (v === undefined) return;
      await tx.unsafe(`UPDATE ${table} SET ${col} = ${literal(v)} WHERE ${col} IS NULL`);
      await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL`);
      return;
    }
    case "removeField": {
      const node = prev.fields[c.path];
      if (node?.kind === "owned") {
        const child = ownedChildTable(table, col, node.table);
        await tx.unsafe(`DROP TABLE IF EXISTS ${child} CASCADE`);
      } else if (node?.kind === "reference" && node.cardinality === "many") {
        // N:N — a ligação é uma TABELA de junção, não uma coluna no pai.
        await tx.unsafe(`DROP TABLE IF EXISTS ${joinTableName(table, col)} CASCADE`);
      } else if (node?.kind === "reference") {
        // N:1 — a coluna FK é `<campo>_id`, não `<campo>`.
        await tx.unsafe(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col}_id`);
      } else {
        await tx.unsafe(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col}`);
      }
      return;
    }
    case "makeRequired": {
      const v = fill[c.path];
      if (v !== undefined) {
        await tx.unsafe(`UPDATE ${table} SET ${col} = ${literal(v)} WHERE ${col} IS NULL`);
      }
      await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL`);
      return;
    }
    case "dropRequired":
      await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${col} DROP NOT NULL`);
      return;
    case "addUnique":
      await tx.unsafe(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_${col}_key UNIQUE (${col})`);
      return;
    case "dropUnique":
      await tx.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${col}_key`);
      return;
    case "dropIndex":
      await tx.unsafe(`DROP INDEX IF EXISTS ${indexName(table, col)}`);
      return;
    case "addCompositeUnique":
    case "addCompositeIndex": {
      const uq = c.op === "addCompositeUnique";
      const cols = resolveCompositeColumns(next, c.columns ?? []);
      const name = compositeIndexName(table, cols, uq);
      await tx.unsafe(`CREATE ${uq ? "UNIQUE " : ""}INDEX ${name} ON ${table} (${cols.join(", ")})`);
      return;
    }
    case "dropCompositeUnique":
    case "dropCompositeIndex": {
      const uq = c.op === "dropCompositeUnique";
      // O grupo removido vive no IR ANTERIOR — resolve as colunas por lá.
      const cols = resolveCompositeColumns(prev, c.columns ?? []);
      await tx.unsafe(`DROP INDEX IF EXISTS ${compositeIndexName(table, cols, uq)}`);
      return;
    }
    case "changeDefault": {
      const node = next.fields[c.path] as ColumnIR | undefined;
      if (!node || node.default === undefined) {
        await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT`);
      } else {
        await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${literal(node.default)}`);
      }
      return;
    }
    // renameField (já feito), addField/addIndex (engine), retype/reshape (blocked): nada.
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function blocked(c: FieldChange, detail: string): FieldChange {
  return { ...c, risk: "blocked", detail };
}

// Nome físico da coluna no banco VIVO (antes da migração): casa o field-id contra o
// IR anterior — à prova de rename no mesmo plano. `null` = campo novo neste plano
// (a coluna ainda não existe no banco). Reference N:1 vive em `<campo>_id`.
function prevColumnName(prev: EntityIR, next: EntityIR, field: string): string | null {
  const node = next.fields[field];
  if (!node?.id) return null;
  for (const [prevName, prevNode] of Object.entries(prev.fields)) {
    if (prevNode.id === node.id) {
      return prevNode.kind === "reference" ? `${camelToSnake(prevName)}_id` : camelToSnake(prevName);
    }
  }
  return null;
}

// Nome físico DEPOIS da migração (renames já aplicados no estágio 1): reference N:1
// vive em `<campo>_id`. Campos removidos não constam em `next` → cai no snake_case.
function nextColumnName(next: EntityIR, field: string): string {
  const node = next.fields[field];
  return node?.kind === "reference" ? `${camelToSnake(field)}_id` : camelToSnake(field);
}

/**
 * Versão do IR para o ADITIVO do engine: campos novos required com fill entram como
 * nullable, pra o `ADD COLUMN` não falhar sobre as linhas existentes — o backfill +
 * SET NOT NULL acontecem no estágio 3 (`applyAlter`, op `addField`). O metastore
 * guarda o IR real (required); isto afeta só a materialização desta transação.
 */
export function softenNewRequired(prev: EntityIR | null, next: EntityIR, fill: Record<string, unknown>): EntityIR {
  if (!prev) return next;
  const prevIds = new Set(Object.values(prev.fields).map((f) => f.id));
  let out: EntityIR | null = null;
  for (const [name, node] of Object.entries(next.fields)) {
    if (node.kind !== "column" && node.kind !== "reference") continue;
    const isNew = !node.id || !prevIds.has(node.id);
    const requiredNoDefault = (node.notNull ?? false) && (node.kind !== "column" || node.default === undefined);
    if (isNew && requiredNoDefault && fill[name] !== undefined) {
      out ??= { ...next, fields: { ...next.fields } };
      out.fields[name] = { ...node, notNull: false };
    }
  }
  return out ?? next;
}

async function count(sql: Sql, table: string, where?: string): Promise<number> {
  const rows = (await sql.unsafe(
    `SELECT count(*)::int AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function hasDuplicates(sql: Sql, table: string, col: string): Promise<boolean> {
  const rows = (await sql.unsafe(
    `SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL GROUP BY ${col} HAVING count(*) > 1 LIMIT 1`,
  )) as unknown as unknown[];
  return rows.length > 0;
}

// Resolve um grupo (nomes lógicos) nas colunas: coluna → snake_case; reference N:1 →
// `<campo>_id`. (Owned/N:N já foram barrados no `defineEntity`.)
function resolveCompositeColumns(ir: EntityIR, group: string[]): string[] {
  return group.map((field) => {
    const node = ir.fields[field];
    if (!node) throw new Error(`weave: composite group field '${field}' not found on '${ir.name}'.`);
    return node.kind === "reference" ? `${camelToSnake(field)}_id` : camelToSnake(field);
  });
}

// Duplicatas que violariam um UNIQUE composto. Linhas com QUALQUER coluna NULL não
// conflitam (semântica do Postgres: NULL é distinto), então só contamos as completas.
async function hasDuplicatesComposite(sql: Sql, table: string, cols: string[]): Promise<boolean> {
  const notNull = cols.map((c) => `${c} IS NOT NULL`).join(" AND ");
  const rows = (await sql.unsafe(
    `SELECT 1 FROM ${table} WHERE ${notNull} GROUP BY ${cols.join(", ")} HAVING count(*) > 1 LIMIT 1`,
  )) as unknown as unknown[];
  return rows.length > 0;
}

function literal(v: unknown): string {
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "null";
}
