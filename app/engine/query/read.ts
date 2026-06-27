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

import { type WhereInput, type OrderByInput, Column, type InferColumn, type Entity, type ShapeRecord, Owned, type OwnedShape, Reference, camelToSnake, ownedChildTable, ownedFkColumn, joinTableName, joinTargetFk, singularize } from "@mauroandre/weave-core";


export interface FindOptions<E> {
  where?: WhereInput<E>;
  orderBy?: OrderByInput<E>;
  /** Map of `reference`/`owned` fields to follow; see `ExpandInput`. */
  expand?: ExpandMap;
  /** Prune the result to selected fields; see `SelectInput`. Subsumes `expand`. */
  select?: SelectMap;
  limit?: number;
  offset?: number;
}

/** A runtime expand map: field → `true` or a nested expand map. */
export type ExpandMap = { [field: string]: true | ExpandMap };

/** A compiled, parameterized query. */
export interface CompiledQuery {
  text: string;
  params: unknown[];
}

/** A runtime select map: field → `true` or a nested select map. */
export type SelectMap = { [field: string]: true | SelectMap };

/**
 * Build the `json_build_object(...)` expression for one table level.
 *
 * Two modes: with `select`, emit only the selected fields (id always; timestamps
 * only if selected; `select` subsumes `expand`). Without `select`, the default
 * read shape (owned automatic, references via `expand`).
 *
 * @param table  - SQL alias for column refs (the actual table name).
 * @param prefix - ownership-path prefix used to name owned children.
 */
function buildObject(
  table: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  expand: ExpandMap | undefined,
  select: SelectMap | undefined,
): string {
  const parts: string[] = [`'id', ${table}.id`]; // id always present
  const wants = (key: string): boolean => select === undefined || Boolean(select[key]);

  for (const [field, value] of Object.entries(shape)) {
    // Child select: nested map when given, undefined when `true` (full sub-read).
    const childSelect = select && select[field] !== true ? (select[field] as SelectMap) : undefined;
    const childExpand = select ? undefined : subExpand(expand, field);

    if (value instanceof Owned) {
      if (!wants(field)) continue;
      const childTable = ownedChildTable(prefix, camelToSnake(field), value.options.table);
      const fk = ownedFkColumn(prefix);
      const childObj = buildObject(childTable, childTable, value.shape, childExpand, childSelect);
      const correlate = `${childTable}.${fk} = ${table}.id`;
      const sub =
        value.cardinality === "many"
          ? `(SELECT coalesce(json_agg(${childObj} ORDER BY ${childTable}.created_at), '[]'::json) ` +
            `FROM ${childTable} WHERE ${correlate})`
          : `(SELECT ${childObj} FROM ${childTable} WHERE ${correlate} LIMIT 1)`;
      parts.push(`'${field}', ${sub}`);
    } else if (value instanceof Reference && value.cardinality === "one") {
      const fkCol = `${camelToSnake(field)}_id`;
      // FK id: always in expand mode; only if selected in select mode.
      if (select === undefined ? true : Boolean(select[`${field}Id`])) {
        parts.push(`'${field}Id', ${table}.${fkCol}`);
      }
      const wantObj = select ? select[field] : expand?.[field];
      if (wantObj) {
        const t = value.target.name;
        const targetObj = buildObject(t, singularize(t), value.target.columns, childExpand, childSelect);
        parts.push(`'${field}', (SELECT ${targetObj} FROM ${t} WHERE ${t}.id = ${table}.${fkCol} LIMIT 1)`);
      }
    } else if (value instanceof Reference) {
      // N:N — aggregate linked targets via the join table, on expand/select.
      const wantObj = select ? select[field] : expand?.[field];
      if (wantObj) {
        const t = value.target.name;
        const join = joinTableName(prefix, camelToSnake(field));
        const owningFk = ownedFkColumn(prefix);
        const targetFk = joinTargetFk(camelToSnake(field));
        const targetObj = buildObject(t, singularize(t), value.target.columns, childExpand, childSelect);
        parts.push(
          `'${field}', (SELECT coalesce(json_agg(${targetObj} ORDER BY ${t}.created_at), '[]'::json) ` +
            `FROM ${t} JOIN ${join} ON ${join}.${targetFk} = ${t}.id WHERE ${join}.${owningFk} = ${table}.id)`,
        );
      }
    } else if (value instanceof Column) {
      if (wants(field)) parts.push(`'${field}', ${table}.${camelToSnake(field)}`);
    }
  }

  // Timestamps: always in expand mode; only if selected in select mode.
  if (select === undefined || select["createdAt"]) parts.push(`'createdAt', ${table}.created_at`);
  if (select === undefined || select["updatedAt"]) parts.push(`'updatedAt', ${table}.updated_at`);
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
      case "some": {
        // Algum elemento casa os operadores escalares: EXISTS sobre o unnest.
        const sub =
          v && typeof v === "object"
            ? Object.entries(v as Record<string, unknown>).map(([sop, sv]) => renderOperator("e", sop, sv, params))
            : [];
        conds.push(`EXISTS (SELECT 1 FROM unnest(${col}) AS e WHERE ${sub.length ? sub.join(" AND ") : "TRUE"})`);
        break;
      }
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
    // Campos gerenciados (não estão no shape, mas existem em toda tabela).
    if (key === "createdAt") {
      conds.push(compileFieldFilter(`${table}.created_at`, val, params));
      continue;
    }
    if (key === "updatedAt") {
      conds.push(compileFieldFilter(`${table}.updated_at`, val, params));
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
  const obj = buildObject(table, singularize(table), entity.columns, options.expand, options.select);

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
  lines.push(`ORDER BY ${compileOrderBy(table, singularize(table), entity.columns, options.orderBy)}`);
  if (options.limit != null) lines.push(`LIMIT ${bind(params, options.limit)}`);
  if (options.offset != null) lines.push(`OFFSET ${bind(params, options.offset)}`);

  return { text: lines.join("\n"), params };
}

/**
 * Render the `ORDER BY` body (defaults to `created_at` when none given).
 * Suporta caminho ANINHADO (owned 1:1 / reference N:1) via subquery correlata:
 * `{ buyer: { name: "asc" } }` → `(SELECT buyer.name FROM buyer WHERE buyer.id =
 * root.buyer_id LIMIT 1) ASC`. A direção fica na FOLHA; o aninhamento é single-branch.
 */
function compileOrderBy(
  table: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  orderBy: Record<string, unknown> | undefined,
): string {
  const entries = Object.entries(orderBy ?? {});
  if (entries.length === 0) return `${table}.created_at`;
  return entries
    .map(([key, val]) => {
      const { expr, dir } = orderScalar(table, prefix, shape, key, val);
      return `${expr} ${dir}`;
    })
    .join(", ");
}

/** Resolve um termo de ordenação (single-branch) numa expressão escalar + direção. */
function orderScalar(
  table: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  key: string,
  val: unknown,
): { expr: string; dir: "ASC" | "DESC" } {
  const dir = (): "ASC" | "DESC" => (val === "desc" ? "DESC" : "ASC");
  if (key === "id") return { expr: `${table}.id`, dir: dir() };
  if (key === "createdAt") return { expr: `${table}.created_at`, dir: dir() };
  if (key === "updatedAt") return { expr: `${table}.updated_at`, dir: dir() };

  const field = shape[key];
  if (field instanceof Column) return { expr: `${table}.${camelToSnake(key)}`, dir: dir() };

  // Aninhado: o valor é um sub-orderby `{ <subKey>: ... }` (single-branch).
  const [subKey, subVal] = Object.entries((val ?? {}) as Record<string, unknown>)[0] ?? [];
  if (subKey === undefined) throw new Error(`weave: empty orderBy branch at '${key}'.`);

  if (field instanceof Reference && field.cardinality === "one") {
    const t = field.target.name;
    const inner = orderScalar(t, singularize(t), field.target.columns, subKey, subVal);
    return {
      expr: `(SELECT ${inner.expr} FROM ${t} WHERE ${t}.id = ${table}.${camelToSnake(key)}_id LIMIT 1)`,
      dir: inner.dir,
    };
  }
  if (field instanceof Owned && field.cardinality === "one") {
    const childTable = ownedChildTable(prefix, camelToSnake(key), field.options.table);
    const fk = ownedFkColumn(prefix);
    const inner = orderScalar(childTable, childTable, field.shape, subKey, subVal);
    return {
      expr: `(SELECT ${inner.expr} FROM ${childTable} WHERE ${childTable}.${fk} = ${table}.id LIMIT 1)`,
      dir: inner.dir,
    };
  }
  throw new Error(`weave: cannot order by '${key}'.`);
}

/** Compile a `count` into parameterized SQL. */
export function compileCount<E extends Entity<string, ShapeRecord>>(
  entity: E,
  where?: WhereInput<E>,
): CompiledQuery {
  const table = entity.name;
  const params: unknown[] = [];
  const whereSql = compileWhere(
    table,
    singularize(table),
    entity.columns,
    (where ?? {}) as Record<string, unknown>,
    params,
  );
  let text = `SELECT count(*)::int AS n FROM ${table}`;
  if (whereSql) text += ` WHERE ${whereSql}`;
  return { text, params };
}
