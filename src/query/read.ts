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

// Field discriminators / extractors (by phantom / kind tag).
type IsColumn<V> = V extends { _types: unknown } ? true : false;
type IsOwned<V> = V extends { kind: "owned" } ? true : false;
type IsRefOne<V> = V extends { _phantom: { cardinality: "one" } } ? true : false;
type IsRefMany<V> = V extends { _phantom: { cardinality: "many" } } ? true : false;
type ColumnData<V> = V extends { _types: { data: infer D } } ? D : never;
type RefTargetShape<V> = V extends { _phantom: { target: Entity<string, infer TS> } } ? TS : never;

/** Recursion-depth budget for nested filters (cyclic/deep guard). */
type WBudget = [unknown, unknown, unknown, unknown, unknown, unknown];
type WDrop<D extends unknown[]> = D extends [unknown, ...infer R] ? R : [];

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

/** A scalar column filter: a bare value (eq shorthand) or an operator object. */
export type Filter<T> = T | ScalarOps<T>;

/** Operators for a scalar-array column (`text[]`, …). */
export type ArrayFilter<E> = {
  has?: E;
  hasSome?: E[];
  hasEvery?: E[];
  isEmpty?: boolean;
};

/** A column's filter — array operators for `type[]`, scalar operators otherwise. */
type ColumnFilter<V> = ColumnData<V> extends (infer E)[] ? ArrayFilter<E> : Filter<ColumnData<V>>;

/** Quantifiers over a to-many relationship (owned 1:N / reference N:N). */
type Quantifier<W> = { some?: W; every?: W; none?: W };

type WhereShape<TShape, D extends unknown[] = WBudget> = {
  id?: Filter<string>;
  and?: WhereShape<TShape, D>[];
  or?: WhereShape<TShape, D>[];
  not?: WhereShape<TShape, D>;
} & (D extends []
  ? {}
  : {
      // scalar / array columns
      [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]?: ColumnFilter<TShape[K]>;
    } & {
      // owned 1:1 → nested filter; owned 1:N → quantifier
      [K in keyof TShape as IsOwned<TShape[K]> extends true ? K : never]?: TShape[K] extends Owned<
        infer S,
        infer C
      >
        ? C extends "many"
          ? Quantifier<WhereShape<S, WDrop<D>>>
          : WhereShape<S, WDrop<D>>
        : never;
    } & {
      // reference N:1 → nested filter on the target
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? K : never]?: WhereShape<
        RefTargetShape<TShape[K]>,
        WDrop<D>
      >;
    } & {
      // reference N:1 → also filter by the FK directly
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? `${K & string}Id` : never]?: Filter<string>;
    } & {
      // reference N:N → quantifier over linked targets
      [K in keyof TShape as IsRefMany<TShape[K]> extends true ? K : never]?: Quantifier<
        WhereShape<RefTargetShape<TShape[K]>, WDrop<D>>
      >;
    });

/**
 * Filter over an entity. Scalar operators (`gt`/`in`/`ilike`/…), array operators
 * (`has`/`hasSome`/…), logical `and`/`or`/`not`, and **nested** filtering over
 * `owned`/`reference` with quantifiers `some`/`every`/`none` — compiled to
 * indexed `EXISTS` subqueries.
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

/** Render one scalar column field's filter (eq shorthand or operator object). */
function compileFieldFilter(col: string, val: unknown, params: unknown[]): string {
  if (!isOperatorMap(val)) {
    return val === null ? `${col} IS NULL` : `${col} = ${bind(params, val)}`;
  }
  const conds = Object.entries(val).map(([op, v]) => renderOperator(col, op, v, params));
  return conds.length ? conds.join(" AND ") : "TRUE";
}

/** Render an array literal `ARRAY[$1, $2, …]` binding each element. */
function arrayLiteral(arr: unknown[], params: unknown[]): string {
  return `ARRAY[${arr.map((v) => bind(params, v)).join(", ")}]`;
}

/** Render a scalar-array column filter (`has`/`hasSome`/`hasEvery`/`isEmpty`). */
function compileArrayFilter(col: string, val: unknown, params: unknown[]): string {
  if (val === null) return `${col} IS NULL`;
  if (typeof val !== "object") return `${col} = ${bind(params, val)}`;
  const conds: string[] = [];
  for (const [op, v] of Object.entries(val as Record<string, unknown>)) {
    switch (op) {
      case "has":
        conds.push(`${bind(params, v)} = ANY(${col})`);
        break;
      case "hasSome":
        conds.push(Array.isArray(v) && v.length ? `${col} && ${arrayLiteral(v, params)}` : "FALSE");
        break;
      case "hasEvery":
        conds.push(Array.isArray(v) && v.length ? `${col} @> ${arrayLiteral(v, params)}` : "TRUE");
        break;
      case "isEmpty":
        conds.push(v ? `cardinality(${col}) = 0` : `cardinality(${col}) > 0`);
        break;
      default:
        throw new Error(`weave: unknown array operator '${op}'.`);
    }
  }
  return conds.length ? conds.join(" AND ") : "TRUE";
}

/** `EXISTS`/`NOT EXISTS (SELECT 1 FROM <from> WHERE <correlate> [AND <inner>])`. */
function existsClause(from: string, correlate: string, inner: string, negate: boolean): string {
  const cond = inner ? `${correlate} AND ${inner}` : correlate;
  return `${negate ? "NOT EXISTS" : "EXISTS"} (SELECT 1 FROM ${from} WHERE ${cond})`;
}

/** Compile a `some`/`every`/`none` quantifier over a to-many relationship. */
function compileQuantifier(
  from: string,
  alias: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  val: unknown,
  params: unknown[],
  correlate: string,
): string {
  const out: string[] = [];
  for (const [q, w] of Object.entries(val as Record<string, unknown>)) {
    const inner = compileWhere(alias, prefix, shape, w as Record<string, unknown>, params);
    if (q === "some") {
      out.push(existsClause(from, correlate, inner, false));
    } else if (q === "none") {
      out.push(existsClause(from, correlate, inner, true));
    } else if (q === "every") {
      const notInner = inner ? `NOT (${inner})` : "FALSE";
      out.push(`NOT EXISTS (SELECT 1 FROM ${from} WHERE ${correlate} AND ${notInner})`);
    } else {
      throw new Error(`weave: unknown quantifier '${q}' (use some/every/none).`);
    }
  }
  return out.length ? out.join(" AND ") : "TRUE";
}

/**
 * Compile a where object into a SQL condition. Descends into `owned`/`reference`
 * via correlated `EXISTS` subqueries. Recursive for `and`/`or`/`not`.
 */
function compileWhere(
  table: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  where: Record<string, unknown>,
  params: unknown[],
): string {
  const conds: string[] = [];
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;

    if (key === "and" || key === "or") {
      if (!Array.isArray(val)) continue;
      const subs = val
        .map((w) => compileWhere(table, prefix, shape, w as Record<string, unknown>, params))
        .filter((s) => s.length > 0);
      if (subs.length) conds.push(`(${subs.join(key === "and" ? " AND " : " OR ")})`);
      continue;
    }
    if (key === "not") {
      const s = compileWhere(table, prefix, shape, val as Record<string, unknown>, params);
      if (s) conds.push(`NOT (${s})`);
      continue;
    }
    if (key === "id") {
      conds.push(compileFieldFilter(`${table}.id`, val, params));
      continue;
    }

    const field = shape[key];
    if (field instanceof Column) {
      const col = `${table}.${camelToSnake(key)}`;
      conds.push(field.config.isArray ? compileArrayFilter(col, val, params) : compileFieldFilter(col, val, params));
    } else if (field instanceof Owned) {
      const childTable = ownedChildTable(prefix, camelToSnake(key), field.options.table);
      const fk = ownedFkColumn(prefix);
      const correlate = `${childTable}.${fk} = ${table}.id`;
      if (field.cardinality === "many") {
        conds.push(compileQuantifier(childTable, childTable, childTable, field.shape, val, params, correlate));
      } else {
        const inner = compileWhere(childTable, childTable, field.shape, val as Record<string, unknown>, params);
        conds.push(existsClause(childTable, correlate, inner, false));
      }
    } else if (field instanceof Reference && field.cardinality === "one") {
      const t = field.target.name;
      const inner = compileWhere(t, singularize(t), field.target.columns, val as Record<string, unknown>, params);
      conds.push(existsClause(t, `${t}.id = ${table}.${camelToSnake(key)}_id`, inner, false));
    } else if (field instanceof Reference) {
      const t = field.target.name;
      const join = joinTableName(prefix, camelToSnake(key));
      const from = `${t} JOIN ${join} ON ${join}.${joinTargetFk(camelToSnake(key))} = ${t}.id`;
      const correlate = `${join}.${ownedFkColumn(prefix)} = ${table}.id`;
      conds.push(compileQuantifier(from, t, singularize(t), field.target.columns, val, params, correlate));
    } else if (key.endsWith("Id")) {
      // `<field>Id` — filter a reference's FK directly, without a join.
      const base = key.slice(0, -2);
      const ref = shape[base];
      if (ref instanceof Reference && ref.cardinality === "one") {
        conds.push(compileFieldFilter(`${table}.${camelToSnake(base)}_id`, val, params));
      } else {
        throw new Error(`weave: unknown filter field '${key}'.`);
      }
    } else {
      throw new Error(`weave: unknown filter field '${key}'.`);
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
  const whereSql = compileWhere(
    table,
    singularize(table),
    entity.columns,
    (options.where ?? {}) as Record<string, unknown>,
    params,
  );

  const lines = [`SELECT ${obj} AS data`, `FROM ${table}`];
  if (whereSql) lines.push(`WHERE ${whereSql}`);
  lines.push(`ORDER BY ${table}.created_at`);

  return { text: lines.join("\n"), params };
}
