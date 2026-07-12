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

import { type WhereInput, type OrderByInput, type AggregateInput, type Accumulator, type GroupExpr, type Expr, type ExprOperand, Column, type InferColumn, type Entity, type ShapeRecord, Owned, type OwnedShape, Reference, camelToSnake, ownedChildTable, ownedFkColumn, joinTableName, joinTargetFk } from "@mauroandre/weave-core";


export interface FindOptions<E> {
  where?: WhereInput<E>;
  orderBy?: OrderByInput<E>;
  /** Map of `reference`/`owned` fields to follow; see `ExpandInput`. */
  expand?: ExpandMap;
  /** Prune the result to selected fields; see `SelectInput`. Subsumes `expand`. */
  select?: SelectMap;
  /**
   * Greatest-n-per-group: uma linha por combinação destes campos (`DISTINCT ON`).
   * Qual linha sobrevive vem do `orderBy` (ex.: `ts` desc → a mais recente). O
   * compilador prefixa estes campos no `ORDER BY` (exigência do `DISTINCT ON`).
   */
  latestPer?: string[];
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
  uid: { n: number },
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
      const childObj = buildObject(childTable, childTable, value.shape, childExpand, childSelect, uid);
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
        // Alias ÚNICO pra tabela-alvo: sem isso, um self-ref (alvo == raiz) colide o
        // nome da tabela consigo mesmo e a correlação vira ambígua. `prefix` fica o nome
        // REAL (pra nomear owned/join internos); o alias `a` só rotula as colunas.
        const real = value.target.name;
        const a = `_r${uid.n++}`;
        const targetObj = buildObject(a, real, value.target.columns, childExpand, childSelect, uid);
        parts.push(`'${field}', (SELECT ${targetObj} FROM ${real} AS ${a} WHERE ${a}.id = ${table}.${fkCol} LIMIT 1)`);
      }
    } else if (value instanceof Reference) {
      // N:N — aggregate linked targets via the join table, on expand/select.
      const wantObj = select ? select[field] : expand?.[field];
      if (wantObj) {
        // Aliases únicos pra tabela-alvo E pra join — imprescindível no self-ref N:N, onde
        // alvo e raiz são a MESMA tabela (`member` ↔ `member`).
        const real = value.target.name;
        const a = `_r${uid.n++}`;
        const j = `_r${uid.n++}`;
        const join = joinTableName(prefix, camelToSnake(field));
        const owningFk = ownedFkColumn(prefix);
        const targetFk = joinTargetFk(camelToSnake(field));
        const targetObj = buildObject(a, real, value.target.columns, childExpand, childSelect, uid);
        parts.push(
          `'${field}', (SELECT coalesce(json_agg(${targetObj} ORDER BY ${a}.created_at), '[]'::json) ` +
            `FROM ${real} AS ${a} JOIN ${join} AS ${j} ON ${j}.${targetFk} = ${a}.id WHERE ${j}.${owningFk} = ${table}.id)`,
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
      const inner = compileWhere(t, t, field.target.columns, val as Record<string, unknown>, params);
      conds.push(existsClause(t, `${t}.id = ${table}.${camelToSnake(key)}_id`, inner, false));
    } else if (field instanceof Reference) {
      const t = field.target.name;
      const join = joinTableName(prefix, camelToSnake(key));
      const from = `${t} JOIN ${join} ON ${join}.${joinTargetFk(camelToSnake(key))} = ${t}.id`;
      const correlate = `${join}.${ownedFkColumn(prefix)} = ${table}.id`;
      conds.push(compileQuantifier(from, t, t, field.target.columns, val, params, correlate));
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
  const obj = buildObject(table, table, entity.columns, options.expand, options.select, { n: 0 });

  const params: unknown[] = [];
  const whereSql = compileWhere(
    table,
    table,
    entity.columns,
    (options.where ?? {}) as Record<string, unknown>,
    params,
  );

  // latestPer → DISTINCT ON (cols): as colunas do grupo VALIDADAS (aggCol = barreira
  // anti-injection) e prefixadas no ORDER BY (o Postgres exige que liderem a ordenação).
  const lp = options.latestPer;
  const distinctExprs = lp && lp.length ? lp.map((k) => aggCol(table, entity.columns, k)) : null;
  const distinctOn = distinctExprs ? `DISTINCT ON (${distinctExprs.join(", ")}) ` : "";
  const userOrder = compileOrderBy(table, table, entity.columns, options.orderBy);
  const orderBody = distinctExprs ? `${distinctExprs.join(", ")}, ${userOrder}` : userOrder;

  const lines = [`SELECT ${distinctOn}${obj} AS data`, `FROM ${table}`];
  if (whereSql) lines.push(`WHERE ${whereSql}`);
  lines.push(`ORDER BY ${orderBody}`);
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
    const inner = orderScalar(t, t, field.target.columns, subKey, subVal);
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

/** Compile a `count` into parameterized SQL. Com `latestPer`, conta GRUPOS distintos
 *  (`count(DISTINCT (cols))`) — pra paginar sobre um resultado greatest-n-per-group. */
export function compileCount<E extends Entity<string, ShapeRecord>>(
  entity: E,
  where?: WhereInput<E>,
  latestPer?: string[],
): CompiledQuery {
  const table = entity.name;
  const params: unknown[] = [];
  const whereSql = compileWhere(
    table,
    table,
    entity.columns,
    (where ?? {}) as Record<string, unknown>,
    params,
  );
  const cnt =
    latestPer && latestPer.length
      ? `count(DISTINCT (${latestPer.map((k) => aggCol(table, entity.columns, k)).join(", ")}))::int`
      : "count(*)::int";
  let text = `SELECT ${cnt} AS n FROM ${table}`;
  if (whereSql) text += ` WHERE ${whereSql}`;
  return { text, params };
}

// ── Aggregation (Phase: OLAP) ───────────────────────────────────────────────────
// Compila `AggregateInput` num `SELECT … GROUP BY … ORDER BY`. Reusa `compileWhere`.
// IDENTIFICADORES (campos, aliases) são VALIDADOS contra o shape / regex — nunca vêm
// param-bindados (não dá), então a validação é a barreira contra injection.

// Output aliases go into quoted `AS "…"` / `ORDER BY "…"`. A `groupBy` array entry defaults
// its alias to the field STRING, which may be a dot-path (`"respondent.departmentSlug"`) — so
// dots are allowed. Still no `"`, so the quoted identifier can't break out (anti-injection).
const IDENT_RE = /^[A-Za-z0-9_.]+$/;

function safeAlias(alias: string): string {
  if (!IDENT_RE.test(alias)) throw new Error(`weave: invalid aggregate alias '${alias}'.`);
  return alias;
}

/** Coluna de um campo (managed, escalar ou FK de reference N:1), validada contra o shape
 *  (barreira anti-injection). Reference N:1 agrupa pela coluna FK `<campo>_id` — mesma
 *  resolução do `where` (aceita `respondent` OU `respondentId`). */
function aggCol(table: string, shape: ShapeRecord | OwnedShape, key: string): string {
  if (key === "id") return `${table}.id`;
  if (key === "createdAt") return `${table}.created_at`;
  if (key === "updatedAt") return `${table}.updated_at`;
  const node = (shape as Record<string, unknown>)[key];
  if (node instanceof Column) return `${table}.${camelToSnake(key)}`;
  // Reference N:1 → agrupa/ordena pela FK `<campo>_id` (uuid). groupBy/latestPer/distinct
  // por reference (department, company, respondent) — o hotspot de stats do consumidor.
  if (node instanceof Reference && node.cardinality === "one") return `${table}.${camelToSnake(key)}_id`;
  // Forma `<campo>Id` — o FK direto, como o `where` aceita.
  if (key.endsWith("Id")) {
    const base = key.slice(0, -2);
    const ref = (shape as Record<string, unknown>)[base];
    if (ref instanceof Reference && ref.cardinality === "one") return `${table}.${camelToSnake(base)}_id`;
  }
  throw new Error(`weave: unknown field '${key}' in aggregate.`);
}

interface PathNode {
  alias: string; // what column refs use (root table name, or a `_aN` join alias)
  naming: string; // real table/path for deriving owned children (owned FK + child table)
  shape: ShapeRecord | OwnedShape;
}

/**
 * Resolves aggregate field paths to SQL column expressions, building the FROM's JOINs on
 * demand. A bare field (`"status"`) resolves against the root — no JOIN, identical to the
 * flat aggregate. A dot-path (`"respondent.departmentSlug"`, `"managerResult.anchors.name"`)
 * walks the shape, LEFT-JOINing each `reference` (N:1) / `owned` (1:1) hop, and returns the
 * leaf column. Prefixes are shared: `anchors.name` and `anchors.value` reuse one JOIN.
 *
 * An `owned` LIST hop fans the rows out (one per element) and is allowed ONLY when its path
 * is the declared `unnest` — that hop is an INNER JOIN; any other list hop is an error.
 * IDENTIFIERS are validated against the shape (the anti-injection barrier), never bound.
 */
class AggPaths {
  readonly joins: string[] = [];
  private readonly reg = new Map<string, PathNode>();
  private n = 0;

  constructor(
    rootTable: string,
    rootShape: ShapeRecord | OwnedShape,
    private readonly unnestPath?: string,
  ) {
    this.reg.set("", { alias: rootTable, naming: rootTable, shape: rootShape });
    if (unnestPath) {
      const segs = unnestPath.split(".");
      const parent = this.walk(segs.slice(0, -1));
      const field = (parent.shape as Record<string, unknown>)[segs[segs.length - 1]!];
      if (!(field instanceof Owned) || field.cardinality !== "many") {
        throw new Error(`weave: unnest '${unnestPath}' must be an owned list.`);
      }
      this.walk(segs); // register the fan-out (INNER) JOIN up front
    }
  }

  /** JOIN lines for the FROM clause, in dependency order. */
  joinSql(): string {
    return this.joins.length ? "\n" + this.joins.join("\n") : "";
  }

  /** A (possibly dotted) field path → its SQL column expression, registering JOINs. */
  col(path: string): string {
    const segs = path.split(".");
    const leaf = segs.pop()!;
    const node = this.walk(segs);
    return aggCol(node.alias, node.shape, leaf);
  }

  /** The alias of the table a path's leaf lives on — for `first`'s `ORDER BY <alias>.created_at`. */
  aliasOf(path: string): string {
    const segs = path.split(".");
    segs.pop();
    return this.walk(segs).alias;
  }

  private walk(segs: string[]): PathNode {
    let key = "";
    let node = this.reg.get("")!;
    for (const seg of segs) {
      key = key ? `${key}.${seg}` : seg;
      const cached = this.reg.get(key);
      if (cached) {
        node = cached;
        continue;
      }
      node = this.hop(node, key, seg);
      this.reg.set(key, node);
    }
    return node;
  }

  private hop(parent: PathNode, key: string, seg: string): PathNode {
    const field = (parent.shape as Record<string, unknown>)[seg];
    const segSnake = camelToSnake(seg);
    const alias = `_a${this.n++}`;
    if (field instanceof Reference && field.cardinality === "one") {
      const t = field.target.name;
      this.joins.push(`LEFT JOIN ${t} ${alias} ON ${alias}.id = ${parent.alias}.${segSnake}_id`);
      return { alias, naming: t, shape: field.target.columns };
    }
    if (field instanceof Owned && field.cardinality === "one") {
      const child = ownedChildTable(parent.naming, segSnake, field.options.table);
      this.joins.push(`LEFT JOIN ${child} ${alias} ON ${alias}.${ownedFkColumn(parent.naming)} = ${parent.alias}.id`);
      return { alias, naming: child, shape: field.shape };
    }
    if (field instanceof Owned && field.cardinality === "many") {
      if (key !== this.unnestPath) {
        throw new Error(`weave: '${key}' is an owned list — aggregate through it needs \`unnest: "${key}"\`.`);
      }
      const child = ownedChildTable(parent.naming, segSnake, field.options.table);
      // INNER JOIN: the fan-out. A parent with no elements contributes nothing (like `$unwind`).
      this.joins.push(`JOIN ${child} ${alias} ON ${alias}.${ownedFkColumn(parent.naming)} = ${parent.alias}.id`);
      return { alias, naming: child, shape: field.shape };
    }
    throw new Error(`weave: cannot aggregate through '${key}'.`);
  }
}

/**
 * An accumulator's `{ where }` → the `FILTER (WHERE …)` predicate. Field-vs-const, AND/OR/NOT,
 * and dot-paths resolved through the SAME JOINs as the fields — so under `unnest` a path
 * addresses the ELEMENT (`{ "…anchors.alignment": { eq: "high" } }` → `_aN.alignment = $x`).
 * Deliberately NOT the full `where` grammar (no owned quantifiers) — that's the top-level `where`.
 */
function aggFilterWhere(paths: AggPaths, where: Record<string, unknown>, params: unknown[]): string {
  const conds: string[] = [];
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;
    if (key === "and" || key === "or") {
      if (!Array.isArray(val)) continue;
      const subs = val
        .map((w) => aggFilterWhere(paths, w as Record<string, unknown>, params))
        .filter((s) => s.length > 0);
      if (subs.length) conds.push(`(${subs.join(key === "and" ? " AND " : " OR ")})`);
      continue;
    }
    if (key === "not") {
      const s = aggFilterWhere(paths, val as Record<string, unknown>, params);
      if (s) conds.push(`NOT (${s})`);
      continue;
    }
    conds.push(compileFieldFilter(paths.col(key), val, params));
  }
  return conds.join(" AND ");
}

/** "5min" → 300s. Uniforme (epoch-floor) pra qualquer intervalo. */
function intervalSeconds(interval: string): number {
  const m = /^(\d+)(s|min|h|d)$/.exec(interval.trim());
  if (!m) throw new Error(`weave: invalid timeBucket interval '${interval}' (use 30s, 5min, 1h, 1d).`);
  const unit = { s: 1, min: 60, h: 3600, d: 86400 }[m[2] as "s" | "min" | "h" | "d"];
  return Number(m[1]) * unit;
}

function groupSql(paths: AggPaths, g: string | GroupExpr): string {
  if (typeof g === "string") return paths.col(g);
  const { field, interval } = g.timeBucket;
  const secs = intervalSeconds(interval);
  // epoch-floor: alinhado por UTC, uniforme pra qualquer intervalo (Decisão: epoch/UTC).
  return `to_timestamp(floor(extract(epoch from ${paths.col(field)}) / ${secs}) * ${secs})`;
}

// Um acumulador → expressão SQL. `{ where }` (opcional) vira `… FILTER (WHERE …)`.
// `params` recebe os binds na ORDEM em que a expressão aparece no SELECT (o chamador
// respeita a ordem SELECT→WHERE→HAVING pra os $N baterem com `.unsafe`).
function accSql(paths: AggPaths, acc: Accumulator, params: unknown[]): string {
  const wRaw = (acc as { where?: Record<string, unknown> }).where;

  // histogram monta N+1 `count(*) FILTER` num array[] — trata o `{ where }` INLINE
  // (AND-ado em cada balde), já que não dá pra pôr FILTER sobre o array constructor.
  if (acc.agg === "histogram") {
    return histogramSql(paths, acc, params, wRaw);
  }

  let base: string;
  switch (acc.agg) {
    case "count":
      base = "count(*)";
      break;
    case "sum":
    case "avg":
    case "min":
    case "max":
      base = `${acc.agg}(${paths.col(acc.field)})`;
      break;
    case "distinct":
      base = `count(distinct ${paths.col(acc.field)})`;
      break;
    case "first":
      // One representative per group, deterministic by the element's created_at.
      base = `(array_agg(${paths.col(acc.field)} ORDER BY ${paths.aliasOf(acc.field)}.created_at))[1]`;
      break;
    case "percentile": {
      const p = acc.p;
      if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p >= 1) {
        throw new Error(`weave: percentile p must be a fraction between 0 and 1 (got ${JSON.stringify(p)}).`);
      }
      base = `percentile_cont(${bind(params, p)}) WITHIN GROUP (ORDER BY ${paths.col(acc.field)})`;
      break;
    }
    default:
      throw new Error(`weave: unknown accumulator '${(acc as { agg?: string }).agg}'.`);
  }
  if (wRaw && Object.keys(wRaw).length) {
    const f = aggFilterWhere(paths, wRaw, params);
    if (f) base += ` FILTER (WHERE ${f})`;
  }
  return base;
}

// N fronteiras (estritamente crescentes) → N+1 baldes: `< b0`, `[b0,b1)`, …, `>= b_{N-1}`
// (overflow). Cada balde é um `count(*) FILTER`; o array[] os junta num valor só. As
// fronteiras são BINDADAS (validadas numéricas); um `{ where }` opcional é AND-ado em todos.
function histogramSql(
  paths: AggPaths,
  acc: { field: string; bounds: number[] },
  params: unknown[],
  where?: Record<string, unknown>,
): string {
  const bounds = acc.bounds;
  if (!Array.isArray(bounds) || bounds.length === 0) {
    throw new Error("weave: histogram needs at least one boundary.");
  }
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    if (typeof b !== "number" || !Number.isFinite(b)) {
      throw new Error("weave: histogram boundaries must be finite numbers.");
    }
    if (i > 0 && b <= (bounds[i - 1] as number)) {
      throw new Error("weave: histogram boundaries must be strictly ascending.");
    }
  }
  const col = paths.col(acc.field);
  const ph = bounds.map((b) => bind(params, b)); // fronteira → $N (bindada uma vez, reusada)
  const w = where && Object.keys(where).length ? aggFilterWhere(paths, where, params) : "";
  const andW = w ? ` AND (${w})` : "";
  const bucket = (cond: string) => `count(*) FILTER (WHERE ${cond}${andW})`;

  const buckets = [bucket(`${col} < ${ph[0]}`)];
  for (let i = 1; i < ph.length; i++) buckets.push(bucket(`${col} >= ${ph[i - 1]} AND ${col} < ${ph[i]}`));
  buckets.push(bucket(`${col} >= ${ph[ph.length - 1]}`)); // balde de overflow (+∞)
  return `array[${buckets.join(", ")}]`;
}

/** Compila um `aggregate` em SQL parametrizado. Devolve linhas agrupadas (alias → valor). */
// Um nó do `select` é Expr (aritmético) quando tem `op`; senão é Accumulator (`agg`).
function isExpr(node: unknown): node is Expr {
  return typeof node === "object" && node !== null && "op" in node;
}

// Resolve um operando de expressão em SQL. String = nome de um alias já resolvido
// (inlina a expressão dele — o Postgres não referencia alias de SELECT no mesmo SELECT).
// Número = bindado. Acumulador inline = accSql. Expr aninhada = recursão.
function operandSql(
  operand: ExprOperand,
  aliasExpr: Record<string, string>,
  paths: AggPaths,
  params: unknown[],
): string {
  if (typeof operand === "number") {
    if (!Number.isFinite(operand)) throw new Error("weave: expression numbers must be finite.");
    return bind(params, operand);
  }
  if (typeof operand === "string") {
    const e = aliasExpr[operand];
    if (!e) throw new Error(`weave: expression references unknown select alias '${operand}'.`);
    return e;
  }
  if (isExpr(operand)) return exprSql(operand, aliasExpr, paths, params);
  return accSql(paths, operand, params); // acumulador inline
}

// Expressão aritmética → SQL. `div` protege contra divisão-por-zero (nullif) e casta
// pra numeric (senão int/int trunca). Parênteses generosos preservam a precedência.
function exprSql(
  node: Expr,
  aliasExpr: Record<string, string>,
  paths: AggPaths,
  params: unknown[],
): string {
  const l = operandSql(node.left, aliasExpr, paths, params);
  const r = operandSql(node.right, aliasExpr, paths, params);
  switch (node.op) {
    case "div":
      return `((${l})::numeric / nullif((${r}), 0))`;
    case "mul":
      return `((${l}) * (${r}))`;
    case "add":
      return `((${l}) + (${r}))`;
    case "sub":
      return `((${l}) - (${r}))`;
    default:
      throw new Error(`weave: unknown expression op '${(node as { op?: string }).op}'.`);
  }
}

export function compileAggregate<E extends Entity<string, ShapeRecord>>(
  entity: E,
  input: AggregateInput<E>,
): CompiledQuery {
  const table = entity.name;
  const shape = entity.columns;
  const params: unknown[] = [];

  // Path resolver — bare fields hit the root (flat, as before); dot-paths LEFT-JOIN through
  // `owned`/`reference`, and `unnest` INNER-JOINs one owned list (fan-out to its elements).
  const paths = new AggPaths(table, shape, (input as { unnest?: string }).unnest);

  // Chaves de grupo: array de campos (alias homônimo) ou mapa alias → campo|expr.
  const groups: { alias: string; expr: string }[] = [];
  const gb = input.groupBy;
  if (Array.isArray(gb)) {
    for (const f of gb) groups.push({ alias: safeAlias(f), expr: groupSql(paths, f) });
  } else if (gb) {
    for (const [alias, g] of Object.entries(gb)) groups.push({ alias: safeAlias(alias), expr: groupSql(paths, g) });
  }

  const cols: string[] = groups.map((g) => `${g.expr} AS "${g.alias}"`);
  // alias → expressão SQL. Reusado NO HAVING (o Postgres não aceita alias de saída no
  // HAVING, então re-emitimos a expressão idêntica: mesmos $N — bind uma vez, ref N) e
  // pelas EXPRESSÕES (que inlinam aliases de acumuladores). Duas passadas: acumuladores
  // primeiro (populam o mapa), expressões depois (podem referenciar qualquer alias já visto).
  const aliasExpr: Record<string, string> = {};
  const deferred: [string, Expr][] = [];
  for (const [alias, node] of Object.entries(input.select ?? {})) {
    const a = safeAlias(alias);
    if (isExpr(node)) {
      deferred.push([a, node]); // passada 2
      continue;
    }
    const expr = accSql(paths, node as Accumulator, params);
    aliasExpr[a] = expr;
    cols.push(`${expr} AS "${a}"`);
  }
  for (const [a, node] of deferred) {
    const expr = exprSql(node, aliasExpr, paths, params);
    aliasExpr[a] = expr;
    cols.push(`${expr} AS "${a}"`);
  }
  if (cols.length === 0) throw new Error("weave: aggregate needs at least one `select`.");

  const whereSql = compileWhere(table, table, shape, (input.where ?? {}) as Record<string, unknown>, params);

  // HAVING: mesmo shorthand escalar do `where`, mas o "campo" é a expressão do alias
  // (acumulador OU expressão, reusada de aliasExpr). `{ requests: { gte: 100 } }`
  // → `HAVING count(*) >= $N`; `{ errorRate: { gt: 0.1 } }` → inlina a div.
  const havingConds: string[] = [];
  for (const [alias, cond] of Object.entries((input.having ?? {}) as Record<string, unknown>)) {
    const expr = aliasExpr[safeAlias(alias)];
    if (!expr) throw new Error(`weave: having references unknown select alias '${alias}'.`);
    havingConds.push(compileFieldFilter(expr, cond, params));
  }

  const lines = [`SELECT ${cols.join(", ")}`, `FROM ${table}${paths.joinSql()}`];
  if (whereSql) lines.push(`WHERE ${whereSql}`);
  if (groups.length) lines.push(`GROUP BY ${groups.map((g) => g.expr).join(", ")}`);
  if (havingConds.length) lines.push(`HAVING ${havingConds.join(" AND ")}`);
  const ob = input.orderBy ? Object.entries(input.orderBy) : [];
  if (ob.length) {
    // ORDER BY por ALIAS de saída (grupo ou acumulador) — permitido pelo Postgres.
    lines.push(`ORDER BY ${ob.map(([a, d]) => `"${safeAlias(a)}" ${d === "desc" ? "DESC" : "ASC"}`).join(", ")}`);
  }
  // page/perPage → LIMIT/OFFSET (top-N paginado; pressupõe orderBy pra ser determinístico).
  if (input.perPage != null || input.page != null) {
    const pp = Math.max(1, Math.floor(Number(input.perPage) || 20));
    const pg = Math.max(1, Math.floor(Number(input.page) || 1));
    lines.push(`LIMIT ${pp} OFFSET ${(pg - 1) * pp}`);
  }
  return { text: lines.join("\n"), params };
}
