/**
 * DDL emitter (Phase 1b).
 *
 * Turns an {@link Entity} into `CREATE TABLE` / `CREATE INDEX` SQL for scalars
 * and arrays. Decisions baked in:
 *
 *   - `id`         → `uuid PRIMARY KEY DEFAULT uuidv7()` (PG 18 native v7).
 *   - timestamps   → `timestamp with time zone NOT NULL DEFAULT now()`.
 *                    `updated_at` is bumped app-side in `save()`, so no trigger.
 *   - column names → snake_case; table name is used verbatim.
 *
 * `owned` / `reference` (FKs, prefixed tables) are not handled here — they land
 * in Phases 2 and 3.
 */

import type { ColumnConfig } from "../schema/column.js";
import type { Entity, ShapeRecord } from "../schema/entity.js";
import { camelToSnake, indexName } from "../util/naming.js";

const TIMESTAMP_SQL = "timestamp with time zone";

/** Render a SQL literal for a column default. */
function renderDefault(value: unknown, isArray: boolean): string {
  if (isArray) {
    if (Array.isArray(value) && value.length === 0) return "'{}'";
    throw new Error(
      "weave: only an empty-array default ('{}') is supported for array columns in v1.",
    );
  }
  switch (typeof value) {
    case "string":
      return `'${value.replace(/'/g, "''")}'`;
    case "number":
    case "bigint":
      return String(value);
    case "boolean":
      return value ? "true" : "false";
    default:
      throw new Error(
        `weave: unsupported default value of type '${typeof value}'. ` +
          "Use string, number, bigint, boolean, or an empty array.",
      );
  }
}

/** Render one user column line (without indentation). */
function renderColumn(name: string, config: ColumnConfig): string {
  const col = camelToSnake(name);
  const type = config.isArray ? `${config.pgType.sqlType}[]` : config.pgType.sqlType;

  let line = `${col} ${type}`;
  if (config.notNull) line += " NOT NULL";
  if (config.hasDefault) line += ` DEFAULT ${renderDefault(config.default, config.isArray)}`;
  if (config.unique) line += " UNIQUE";
  return line;
}

/** Emit the `CREATE TABLE` statement for an entity (system columns included). */
export function emitCreateTable(entity: Entity<string, ShapeRecord>): string {
  const lines: string[] = [];

  lines.push("id uuid PRIMARY KEY DEFAULT uuidv7()");
  for (const [name, column] of Object.entries(entity.columns)) {
    lines.push(renderColumn(name, column.config));
  }
  lines.push(`created_at ${TIMESTAMP_SQL} NOT NULL DEFAULT now()`);
  lines.push(`updated_at ${TIMESTAMP_SQL} NOT NULL DEFAULT now()`);

  const body = lines.map((l) => `  ${l}`).join(",\n");
  return `CREATE TABLE ${entity.name} (\n${body}\n);`;
}

/** Emit a `CREATE INDEX` per column flagged with `.index()`. */
export function emitIndexes(entity: Entity<string, ShapeRecord>): string[] {
  const out: string[] = [];
  for (const [name, column] of Object.entries(entity.columns)) {
    if (!column.config.index) continue;
    const col = camelToSnake(name);
    out.push(`CREATE INDEX ${indexName(entity.name, col)} ON ${entity.name} (${col});`);
  }
  return out;
}

/** Emit the full DDL for an entity: the table, then any indexes. */
export function emitEntity(entity: Entity<string, ShapeRecord>): string {
  return [emitCreateTable(entity), ...emitIndexes(entity)].join("\n");
}
