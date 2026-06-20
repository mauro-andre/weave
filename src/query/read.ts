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
import { Reference } from "../schema/reference.js";
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
  /** Map of `reference`/`owned` fields to follow; see `ExpandInput`. */
  expand?: ExpandMap;
}

/** A runtime expand map: field → `true` or a nested expand map. */
export type ExpandMap = { [field: string]: true | ExpandMap };

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
function buildObject(
  table: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  expand: ExpandMap | undefined,
): string {
  const parts: string[] = [`'id', ${table}.id`];

  for (const [field, value] of Object.entries(shape)) {
    if (value instanceof Owned) {
      const childTable = ownedChildTable(prefix, camelToSnake(field), value.options.table);
      const fk = ownedFkColumn(prefix);
      const childExpand = subExpand(expand, field);
      const childObj = buildObject(childTable, childTable, value.shape, childExpand);
      const correlate = `${childTable}.${fk} = ${table}.id`;
      const sub =
        value.cardinality === "many"
          ? `(SELECT coalesce(json_agg(${childObj} ORDER BY ${childTable}.created_at), '[]'::json) ` +
            `FROM ${childTable} WHERE ${correlate})`
          : `(SELECT ${childObj} FROM ${childTable} WHERE ${correlate} LIMIT 1)`;
      parts.push(`'${field}', ${sub}`);
    } else if (value instanceof Reference) {
      const fkCol = `${camelToSnake(field)}_id`;
      parts.push(`'${field}Id', ${table}.${fkCol}`); // FK id — always
      if (expand?.[field]) {
        const target = value.target;
        const t = target.name;
        const targetObj = buildObject(t, singularize(t), target.columns, subExpand(expand, field));
        parts.push(`'${field}', (SELECT ${targetObj} FROM ${t} WHERE ${t}.id = ${table}.${fkCol} LIMIT 1)`);
      }
    } else if (value instanceof Column) {
      parts.push(`'${field}', ${table}.${camelToSnake(field)}`);
    }
  }

  parts.push(`'createdAt', ${table}.created_at`, `'updatedAt', ${table}.updated_at`);
  return `json_build_object(${parts.join(", ")})`;
}

/** The nested expand map for a field (undefined when not expanded or `true`). */
function subExpand(expand: ExpandMap | undefined, field: string): ExpandMap | undefined {
  const next = expand?.[field];
  return next && next !== true ? next : undefined;
}

/** Compile a `find` into parameterized SQL returning one `data` column per row. */
export function compileFind(
  entity: Entity<string, ShapeRecord>,
  options: FindOptions<Entity<string, ShapeRecord>> = {},
): CompiledQuery {
  const table = entity.name;
  const obj = buildObject(table, singularize(table), entity.columns, options.expand);

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
