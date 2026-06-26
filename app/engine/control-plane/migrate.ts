// Aplicação do plano de edição (estágio 3). O engine só faz aditivo (create
// table/column/index); todo ALTER de coluna existente (rename, drop, not null,
// unique, default, drop index) é emitido aqui, cercando o aditivo do engine,
// tudo numa transação. O usuário nunca vê uma linha desse SQL.

import type postgres from "postgres";
import { weave } from "../index.js";
import { emitChanges } from "../ddl/diff.js";
import { camelToSnake, ownedChildTable, indexName } from "@mauroandre/weave-core";
import { singularize } from "@mauroandre/weave-core";
import { slug } from "@mauroandre/weave-core";
import type { Entity, ShapeRecord } from "@mauroandre/weave-core";
import type { EntityDiff, FieldChange } from "@mauroandre/weave-core";
import type { ColumnIR, EntityIR } from "@mauroandre/weave-core";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
type AnyEntity = Entity<string, ShapeRecord>;

// ── Sondagem: refina o plano estrutural contra o dado vivo ─────────────────────
// Vazio→auto, duplicata→blocked, etc. Mudanças em campos aninhados (dentro de
// um owned) são adiadas — só o topo é editável na v1.
export async function probePlan(
  sql: Sql,
  next: EntityIR,
  plan: EntityDiff,
): Promise<EntityDiff> {
  if (plan.isNew) return plan;
  const changes: FieldChange[] = [];
  for (const c of plan.changes) changes.push(await probeChange(sql, next, c));
  return { ...plan, changes };
}

async function probeChange(sql: Sql, next: EntityIR, c: FieldChange): Promise<FieldChange> {
  if (c.path.includes(".") && c.op !== "addField") {
    return blocked(c, "Editing fields inside a list isn't supported yet.");
  }
  const table = slug(next.name);
  const col = camelToSnake(c.path);

  if (c.op === "addUnique") {
    return (await hasDuplicates(sql, table, col)) ? c : { ...c, risk: "auto" };
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
    return blocked(c, "Set a default value for the new required field, or add it as optional.");
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
  const col = camelToSnake(c.path);

  switch (c.op) {
    case "removeField": {
      const node = prev.fields[c.path];
      if (node?.kind === "owned") {
        const child = ownedChildTable(singularize(table), col, node.table);
        await tx.unsafe(`DROP TABLE IF EXISTS ${child} CASCADE`);
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

function literal(v: unknown): string {
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "null";
}
