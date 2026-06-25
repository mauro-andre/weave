// Compilador de filtro por CAMINHO aninhado. Atravessa owned e reference
// (single ou lista) recursivamente, gerando `EXISTS` aninhados sobre as tabelas
// materializadas — a folha (escalar) carrega o operador. Lista (owned 1:N, N:N,
// e coluna-array) ganha semântica "any" (algum elemento/linha casa) de graça.
// Valores sempre vão como parâmetro vinculado ($n) — nunca concatenados.

import { camelToSnake, ownedChildTable, ownedFkColumn, joinTableName, joinTargetFk } from "../util/naming.js";
import { singularize } from "../util/inflect.js";
import { slug } from "../util/slug.js";
import type { EntityIR, FieldIR } from "../ir/types.js";

/** Uma folha do filtro: um caminho até um escalar + operador + valor. */
export interface Condition {
  /** Segmentos do caminho, pelo nome dos campos (ex.: ["user","addresses","city"]). */
  path: string[];
  /** Operador (contains, equals, gt, isEmpty, isTrue, on, …). */
  op: string;
  /** Valor procurado (ausente em isEmpty/isTrue/isFalse). */
  value?: unknown;
}

/** Árvore booleana: combina sub-nós com AND (`and`) ou OR (`or`), recursivo. */
export type Filter = Condition | { and: Filter[] } | { or: Filter[] };

export interface CompiledFilter {
  sql: string;
  params: unknown[];
}

const TEXT_TYPES = new Set(["text", "varchar", "bpchar"]);
const NUMERIC_TYPES = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);

// Campos gerenciados (não estão no shape do IR, mas existem em toda tabela).
const MANAGED: Record<string, { col: string; type: string }> = {
  id: { col: "id", type: "uuid" },
  createdAt: { col: "created_at", type: "timestamptz" },
  updatedAt: { col: "updated_at", type: "timestamptz" },
};

/**
 * Compila um filtro num predicado SQL booleano referente ao alias `root` (a
 * tabela da entidade raiz). `byName` deve conter os IRs **resolvidos** (mirrors
 * expandidos), e `rootFields` é a forma resolvida da raiz.
 */
export function compileFilter(
  rootName: string,
  rootFields: Record<string, FieldIR>,
  byName: Map<string, EntityIR>,
  filter: Filter,
): CompiledFilter {
  const params: unknown[] = [];
  let aliasN = 0;
  const alias = () => `t${++aliasN}`;
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  const rootPrefix = singularize(slug(rootName));
  const sql = node(filter);
  return { sql, params };

  // Árvore booleana: AND/OR recursivo; cada folha é uma condição (caminho).
  function node(n: Filter): string {
    if ("and" in n) return n.and.length ? `(${n.and.map(node).join(" AND ")})` : "TRUE";
    if ("or" in n) return n.or.length ? `(${n.or.map(node).join(" OR ")})` : "FALSE";
    return walk(rootFields, "root", rootPrefix, n.path, n.op, n.value);
  }

  function walk(
    fields: Record<string, FieldIR>,
    parent: string,
    prefix: string,
    segs: string[],
    op: string,
    value: unknown,
  ): string {
    const [head, ...rest] = segs;
    if (head === undefined) throw new Error("filter: empty path.");
    const node = fields[head];
    const col = camelToSnake(head);

    // Folha: campo escalar (ou gerenciado: id / created at / updated at).
    if (rest.length === 0) {
      if (node?.kind === "column") {
        if (node.array) {
          // Coluna-array → "any": algum elemento casa.
          const e = alias();
          return `EXISTS (SELECT 1 FROM unnest(${parent}.${col}) AS ${e} WHERE ${leaf(e, op, value, node.type)})`;
        }
        return leaf(`${parent}.${col}`, op, value, node.type);
      }
      const m = MANAGED[head];
      if (!node && m) return leaf(`${parent}.${m.col}`, op, value, m.type);
      throw new Error(`filter: '${head}' is not a value field.`);
    }

    if (!node) throw new Error(`filter: unknown field '${head}'.`);

    // Galho: owned ou reference (mesmo padrão EXISTS, elo diferente).
    if (node.kind === "owned") {
      const child = ownedChildTable(prefix, col, node.table);
      const a = alias();
      const inner = walk(node.shape ?? {}, a, child, rest, op, value);
      return `EXISTS (SELECT 1 FROM ${child} ${a} WHERE ${a}.${ownedFkColumn(prefix)} = ${parent}.id AND ${inner})`;
    }
    if (node.kind === "reference") {
      const target = byName.get(node.target);
      if (!target) throw new Error(`filter: unknown reference target '${node.target}'.`);
      const tTable = slug(node.target);
      const tPrefix = singularize(slug(node.target));
      const a = alias();
      if (node.cardinality === "one") {
        const inner = walk(target.fields, a, tPrefix, rest, op, value);
        return `EXISTS (SELECT 1 FROM ${tTable} ${a} WHERE ${a}.id = ${parent}.${col}_id AND ${inner})`;
      }
      const j = alias();
      const inner = walk(target.fields, a, tPrefix, rest, op, value);
      return (
        `EXISTS (SELECT 1 FROM ${joinTableName(prefix, col)} ${j} ` +
        `JOIN ${tTable} ${a} ON ${a}.id = ${j}.${joinTargetFk(col)} ` +
        `WHERE ${j}.${ownedFkColumn(prefix)} = ${parent}.id AND ${inner})`
      );
    }
    throw new Error(`filter: '${head}' can't be traversed.`);
  }

  function leaf(colExpr: string, op: string, value: unknown, type: string): string {
    const isText = TEXT_TYPES.has(type);
    switch (op) {
      case "isEmpty":
        return `${colExpr} IS NULL`;
      case "isTrue":
        return `${colExpr} = ${bind(true)}`;
      case "isFalse":
        return `${colExpr} = ${bind(false)}`;
      case "contains":
        return `${colExpr} ILIKE ${bind(`%${escapeLike(value)}%`)}`;
      case "startsWith":
        return `${colExpr} ILIKE ${bind(`${escapeLike(value)}%`)}`;
      case "equals":
        return isText
          ? `${colExpr} ILIKE ${bind(escapeLike(value))}`
          : `${colExpr} = ${bind(scalar(value, type))}`;
      case "notEquals":
        return isText
          ? `${colExpr} NOT ILIKE ${bind(escapeLike(value))}`
          : `${colExpr} <> ${bind(scalar(value, type))}`;
      case "gt":
        return `${colExpr} > ${bind(scalar(value, type))}`;
      case "gte":
        return `${colExpr} >= ${bind(scalar(value, type))}`;
      case "lt":
        return `${colExpr} < ${bind(scalar(value, type))}`;
      case "lte":
        return `${colExpr} <= ${bind(scalar(value, type))}`;
      case "before":
        return `${colExpr} < ${bind(String(value))}`;
      case "after":
        return `${colExpr} > ${bind(String(value))}`;
      case "on":
        return `${colExpr}::date = ${bind(String(value))}::date`;
      default:
        throw new Error(`filter: unknown operator '${op}'.`);
    }
  }
}

function scalar(value: unknown, type: string): unknown {
  if (NUMERIC_TYPES.has(type)) return Number(value);
  if (type === "bool") return value === true || value === "true";
  return String(value);
}

// Curingas do usuário viram literais (escape com `\`, o default do ILIKE).
function escapeLike(value: unknown): string {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}
