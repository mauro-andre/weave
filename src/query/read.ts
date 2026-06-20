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
import {
  camelToSnake,
  ownedChildTable,
  ownedFkColumn,
  joinTableName,
  joinTargetFk,
} from "../util/naming.js";
import { singularize } from "../util/inflect.js";

type IsColumn<V> = V extends { _types: unknown } ? true : false;
type ColumnData<V> = V extends { _types: { data: infer D } } ? D : never;

/** String-only operators, added when the column's data type is `string`. */
type StringOps = { like?: string; ilike?: string };

/** Comparison/membership operators for a scalar column of type `T`. */
type ScalarOps<T> = {
  eq?: T | null; // null → IS NULL
  ne?: T | null; // null → IS NOT NULL
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  in?: T[];
  notIn?: T[];
  isNull?: boolean;
} & ([T] extends [string] ? StringOps : {});

/** A column filter: a bare value (eq shorthand) or an operator object. */
export type Filter<T> = T | ScalarOps<T>;

type WhereShape<TShape> = {
  /** Filter by the system id. */
  id?: Filter<string>;
  and?: WhereShape<TShape>[];
  or?: WhereShape<TShape>[];
  not?: WhereShape<TShape>;
} & {
  [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]?: Filter<ColumnData<TShape[K]>>;
};

/**
 * Filter over an entity's `id` and root scalar columns, with operators
 * (`gt`/`in`/`ilike`/…) and logical `and`/`or`/`not`. Nested filtering over
 * `owned`/`reference` is Phase 5b.
 */
export type WhereInput<E> = E extends Entity<string, infer TShape> ? WhereShape<TShape> : never;

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
    } else if (value instanceof Reference && value.cardinality === "one") {
      const fkCol = `${camelToSnake(field)}_id`;
      parts.push(`'${field}Id', ${table}.${fkCol}`); // FK id — always
      if (expand?.[field]) {
        const t = value.target.name;
        const targetObj = buildObject(t, singularize(t), value.target.columns, subExpand(expand, field));
        parts.push(`'${field}', (SELECT ${targetObj} FROM ${t} WHERE ${t}.id = ${table}.${fkCol} LIMIT 1)`);
      }
    } else if (value instanceof Reference) {
      // N:N — nothing by default; aggregate linked targets via the join table on expand.
      if (expand?.[field]) {
        const t = value.target.name;
        const join = joinTableName(prefix, camelToSnake(field));
        const owningFk = ownedFkColumn(prefix);
        const targetFk = joinTargetFk(camelToSnake(field));
        const targetObj = buildObject(t, singularize(t), value.target.columns, subExpand(expand, field));
        parts.push(
          `'${field}', (SELECT coalesce(json_agg(${targetObj} ORDER BY ${t}.created_at), '[]'::json) ` +
            `FROM ${t} JOIN ${join} ON ${join}.${targetFk} = ${t}.id WHERE ${join}.${owningFk} = ${table}.id)`,
        );
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

const OPERATORS = new Set([
  "eq", "ne", "gt", "gte", "lt", "lte", "in", "notIn", "like", "ilike", "isNull",
]);

/** Whether a filter value is an operator object (vs a bare eq value). */
function isOperatorMap(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== "object") return false;
  if (Array.isArray(val) || val instanceof Date || val instanceof Uint8Array) return false;
  const keys = Object.keys(val);
  return keys.length > 0 && keys.every((k) => OPERATORS.has(k));
}

function bind(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

/** Render an `IN`/`NOT IN` list (handles the empty-array degenerate cases). */
function renderIn(col: string, arr: unknown, params: unknown[], negate: boolean): string {
  if (!Array.isArray(arr) || arr.length === 0) return negate ? "TRUE" : "FALSE";
  const placeholders = arr.map((v) => bind(params, v)).join(", ");
  return `${col} ${negate ? "NOT IN" : "IN"} (${placeholders})`;
}

/** Render a single operator on a column. */
function renderOperator(col: string, op: string, v: unknown, params: unknown[]): string {
  switch (op) {
    case "eq":
      return v === null ? `${col} IS NULL` : `${col} = ${bind(params, v)}`;
    case "ne":
      return v === null ? `${col} IS NOT NULL` : `${col} <> ${bind(params, v)}`;
    case "gt":
      return `${col} > ${bind(params, v)}`;
    case "gte":
      return `${col} >= ${bind(params, v)}`;
    case "lt":
      return `${col} < ${bind(params, v)}`;
    case "lte":
      return `${col} <= ${bind(params, v)}`;
    case "in":
      return renderIn(col, v, params, false);
    case "notIn":
      return renderIn(col, v, params, true);
    case "like":
      return `${col} LIKE ${bind(params, v)}`;
    case "ilike":
      return `${col} ILIKE ${bind(params, v)}`;
    case "isNull":
      return v ? `${col} IS NULL` : `${col} IS NOT NULL`;
    default:
      throw new Error(`weave: unknown filter operator '${op}'.`);
  }
}

/** Render one column field's filter (eq shorthand or operator object). */
function compileFieldFilter(col: string, val: unknown, params: unknown[]): string {
  if (!isOperatorMap(val)) {
    return val === null ? `${col} IS NULL` : `${col} = ${bind(params, val)}`;
  }
  const conds = Object.entries(val).map(([op, v]) => renderOperator(col, op, v, params));
  return conds.length ? conds.join(" AND ") : "TRUE";
}

/** Compile a where object into a SQL condition (recursive for and/or/not). */
function compileWhere(table: string, where: Record<string, unknown>, params: unknown[]): string {
  const conds: string[] = [];
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;
    if (key === "and" || key === "or") {
      if (!Array.isArray(val)) continue;
      const subs = val
        .map((w) => compileWhere(table, w as Record<string, unknown>, params))
        .filter((s) => s.length > 0);
      if (subs.length) conds.push(`(${subs.join(key === "and" ? " AND " : " OR ")})`);
    } else if (key === "not") {
      const s = compileWhere(table, val as Record<string, unknown>, params);
      if (s) conds.push(`NOT (${s})`);
    } else {
      conds.push(compileFieldFilter(`${table}.${camelToSnake(key)}`, val, params));
    }
  }
  return conds.join(" AND ");
}

/** Compile a `find` into parameterized SQL returning one `data` column per row. */
export function compileFind<E extends Entity<string, ShapeRecord>>(
  entity: E,
  options: FindOptions<E> = {},
): CompiledQuery {
  const table = entity.name;
  const obj = buildObject(table, singularize(table), entity.columns, options.expand);

  const params: unknown[] = [];
  const whereSql = compileWhere(table, (options.where ?? {}) as Record<string, unknown>, params);

  const lines = [`SELECT ${obj} AS data`, `FROM ${table}`];
  if (whereSql) lines.push(`WHERE ${whereSql}`);
  lines.push(`ORDER BY ${table}.created_at`);

  return { text: lines.join("\n"), params };
}
