/**
 * Read compiler — `weave` (Phase 2b).
 *
 * Compiles an entity + filter into a single SQL query that returns the `owned`
 * tree already nested, via correlated subqueries and JSON aggregation (the
 * Gel/EdgeDB strategy — not flat JOINs):
 *
 *   - 1:N owned → `coalesce(json_agg(... ORDER BY created_at), '[]')`.
 *   - 1:1 owned → a single `json_build_object(...)` subquery (or null).
 *
 * Each row comes back as `data`: the full nested object. JSON keys are the
 * declared field names (camelCase); values map to snake_case columns. Types are
 * rehydrated separately (see `rehydrate.ts`) since JSON flattens dates to text.
 *
 * v1 filter: object-literal equality on root scalar columns, AND-combined.
 * Richer filters / ordering / pagination are Phase 5; `reference` expand is
 * Phase 3.
 */

import { Column, type InferColumn } from "../schema/column.js";
import type { Entity, ShapeRecord } from "../schema/entity.js";
import { Owned, type OwnedShape } from "../schema/owned.js";
import { camelToSnake, ownedChildTable, ownedFkColumn } from "../util/naming.js";
import { singularize } from "../util/inflect.js";

/** Equality filter over an entity's `id` and root scalar columns (owned excluded). */
export type WhereInput<E> =
  E extends Entity<string, infer TShape>
    ? { id?: string } & {
        [K in keyof TShape as [InferColumn<TShape[K]>] extends [never] ? never : K]?:
          InferColumn<TShape[K]>;
      }
    : never;

export interface FindOptions<E> {
  where?: WhereInput<E>;
}

/** A compiled, parameterized query. */
export interface CompiledQuery {
  text: string;
  params: unknown[];
}

/**
 * Build the `json_build_object(...)` expression for one table level.
 *
 * @param table  - SQL alias for column refs (the actual table name).
 * @param prefix - ownership-path prefix used to name owned children.
 */
function buildObject(table: string, prefix: string, shape: ShapeRecord | OwnedShape): string {
  const parts: string[] = [`'id', ${table}.id`];

  for (const [field, value] of Object.entries(shape)) {
    if (value instanceof Owned) {
      const childTable = ownedChildTable(prefix, camelToSnake(field), value.options.table);
      const fk = ownedFkColumn(prefix);
      const childObj = buildObject(childTable, childTable, value.shape);
      const correlate = `${childTable}.${fk} = ${table}.id`;
      const sub =
        value.cardinality === "many"
          ? `(SELECT coalesce(json_agg(${childObj} ORDER BY ${childTable}.created_at), '[]'::json) ` +
            `FROM ${childTable} WHERE ${correlate})`
          : `(SELECT ${childObj} FROM ${childTable} WHERE ${correlate} LIMIT 1)`;
      parts.push(`'${field}', ${sub}`);
    } else if (value instanceof Column) {
      parts.push(`'${field}', ${table}.${camelToSnake(field)}`);
    }
  }

  parts.push(`'createdAt', ${table}.created_at`, `'updatedAt', ${table}.updated_at`);
  return `json_build_object(${parts.join(", ")})`;
}

/** Compile a `find` into parameterized SQL returning one `data` column per row. */
export function compileFind(
  entity: Entity<string, ShapeRecord>,
  options: FindOptions<Entity<string, ShapeRecord>> = {},
): CompiledQuery {
  const table = entity.name;
  const obj = buildObject(table, singularize(table), entity.columns);

  const params: unknown[] = [];
  const conditions: string[] = [];
  for (const [field, val] of Object.entries(options.where ?? {})) {
    if (val === undefined) continue;
    params.push(val);
    conditions.push(`${table}.${camelToSnake(field)} = $${params.length}`);
  }

  const lines = [`SELECT ${obj} AS data`, `FROM ${table}`];
  if (conditions.length) lines.push(`WHERE ${conditions.join(" AND ")}`);
  lines.push(`ORDER BY ${table}.created_at`);

  return { text: lines.join("\n"), params };
}
