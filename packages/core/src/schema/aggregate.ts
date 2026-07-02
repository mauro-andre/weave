import type { Entity, ShapeRecord } from "./entity.js";
import type { WhereInput, SortDir } from "./where.js";
import type { AccumulateOp } from "./accumulate.js";

// Linguagem de AGREGAÇÃO em idioma de objeto (irmã do WhereInput). O dev monta
// `groupBy` + acumuladores no `select` + `orderBy`; o engine (compileAggregate)
// compila num `SELECT … GROUP BY … HAVING … ORDER BY`. Os helpers (count/sum/…,
// timeBucket) produzem marcadores que o compilador lê. Coberto: count/sum/avg/min/max
// + distinct + percentile + histogram + `{ where }` por acumulador (→ FILTER) + groupBy
// (campo | timeBucket) + having + orderBy + facets + expressões (div/mul/add/sub). (hll = depois.)

/** Opções comuns a todo acumulador. `where` recorta a métrica → `agg(…) FILTER (WHERE …)`. */
export interface AggOpts {
  readonly where?: Record<string, unknown>;
}

/** Acumulador: marcador que o compilador lê. `count()` não tem campo; o resto tem. */
export type Accumulator =
  | { readonly agg: "count"; readonly where?: Record<string, unknown> }
  | { readonly agg: "sum" | "avg" | "min" | "max" | "distinct"; readonly field: string; readonly where?: Record<string, unknown> }
  | { readonly agg: "percentile"; readonly field: string; readonly p: number; readonly where?: Record<string, unknown> }
  | { readonly agg: "histogram"; readonly field: string; readonly bounds: number[]; readonly where?: Record<string, unknown> };

// Anexa `{ where }` (→ FILTER) preservando o membro específico do union.
const withWhere = <A extends Accumulator>(base: A, opts?: AggOpts): A =>
  opts?.where ? { ...base, where: opts.where } : base;

export const count = (opts?: AggOpts): Accumulator => withWhere({ agg: "count" }, opts);
export const sum = (field: string, opts?: AggOpts): Accumulator => withWhere({ agg: "sum", field }, opts);
export const avg = (field: string, opts?: AggOpts): Accumulator => withWhere({ agg: "avg", field }, opts);
// `min`/`max` são DUPLOS: com um campo (string) são acumuladores de LEITURA
// (`min("durationMs")`); com um valor (number) são ops de ESCRITA do accumulate
// (`min(cpu)` → sketch numérico min/max, §0). O arg desambigua — read usa nome de
// campo, write usa valor numérico; nunca se cruzam num mesmo call-site.
export function min(field: string, opts?: AggOpts): Accumulator;
export function min(value: number): AccumulateOp;
export function min(arg: string | number, opts?: AggOpts): Accumulator | AccumulateOp {
  return typeof arg === "number" ? { op: "min", value: arg } : withWhere({ agg: "min", field: arg }, opts);
}
export function max(field: string, opts?: AggOpts): Accumulator;
export function max(value: number): AccumulateOp;
export function max(arg: string | number, opts?: AggOpts): Accumulator | AccumulateOp {
  return typeof arg === "number" ? { op: "max", value: arg } : withWhere({ agg: "max", field: arg }, opts);
}
/** Distintos EXATOS (`count(distinct …)`) — tier recente. */
export const distinct = (field: string, opts?: AggOpts): Accumulator => withWhere({ agg: "distinct", field }, opts);
/** Percentil EXATO (`percentile_cont`) sobre escalar cru. `p` é fração 0..1 (p95 → 0.95). */
export const percentile = (field: string, p: number, opts?: AggOpts): Accumulator =>
  withWhere({ agg: "percentile", field, p }, opts);
/**
 * Contagem por balde sobre escalar cru (as "barras" de latência). `bounds`
 * ESTRITAMENTE crescente com N fronteiras → **N+1 baldes**: `< b0`, `[b0,b1)`, …,
 * `>= b_{N-1}` (o último é o overflow, +∞). Devolve o array de contagens como UM valor.
 */
export const histogram = (field: string, bounds: number[], opts?: AggOpts): Accumulator =>
  withWhere({ agg: "histogram", field, bounds }, opts);

/** Expressão de grupo por tempo — trunca `field` em baldes de `interval` (epoch/UTC). */
export type GroupExpr = { readonly timeBucket: { readonly field: string; readonly interval: string } };
export const timeBucket = (field: string, interval: string): GroupExpr => ({ timeBucket: { field, interval } });

/**
 * Operando de uma expressão aritmética: **nome de um alias do select** (`"errors"`),
 * um **número** literal, um **acumulador inline** (`count(...)`), ou outra `Expr`.
 */
export type ExprOperand = string | number | Accumulator | Expr;

/** Expressão aritmética sobre agregados (Decisão 5/8). Vale em `orderBy`/`having`. */
export interface Expr {
  readonly op: "div" | "mul" | "add" | "sub";
  readonly left: ExprOperand;
  readonly right: ExprOperand;
}

/** `a / b` — com `nullif(b,0)` (divisão-por-zero → null) e cast numérico (sem trunc inteiro). */
export const div = (left: ExprOperand, right: ExprOperand): Expr => ({ op: "div", left, right });
export const mul = (left: ExprOperand, right: ExprOperand): Expr => ({ op: "mul", left, right });
export const add = (left: ExprOperand, right: ExprOperand): Expr => ({ op: "add", left, right });
export const sub = (left: ExprOperand, right: ExprOperand): Expr => ({ op: "sub", left, right });

/**
 * Uma faceta: sub-agregação independente que RODA SOB O MESMO `where` do pai. É o
 * `aggregate` sem `where`/`facets` (herda o do pai) e com `limit` (top-N por faceta —
 * pressupõe `orderBy`). Alimenta o caso dashboard: vários breakdowns numa passada.
 */
export interface FacetInput<E extends Entity<string, ShapeRecord>> {
  groupBy?: string[] | Record<string, string | GroupExpr>;
  select: Record<string, Accumulator | Expr>;
  having?: Record<string, unknown>;
  orderBy?: Record<string, SortDir>;
  limit?: number;
}

/**
 * Entrada do `aggregate`. `groupBy`: array de campos (chaves homônimas) OU mapa
 * `alias → campo | expr`. `select`: `alias → acumulador`. `having`: filtro sobre os
 * ALIASES do select (agregados) → `HAVING`. `orderBy`: por alias do select OU chave
 * de grupo. `page`/`perPage`: top-N paginado (pressupõe `orderBy`). `facets`: mapa de
 * sub-agregações independentes (breakdowns) sob o mesmo `where`. `where` é o mesmo
 * `WhereInput` do find (filtra ANTES de agrupar).
 */
export interface AggregateInput<E extends Entity<string, ShapeRecord>> {
  where?: WhereInput<E>;
  groupBy?: string[] | Record<string, string | GroupExpr>;
  select: Record<string, Accumulator | Expr>;
  having?: Record<string, unknown>;
  orderBy?: Record<string, SortDir>;
  page?: number;
  perPage?: number;
  facets?: Record<string, FacetInput<E>>;
}

/**
 * Uma linha agregada: chaves de grupo + aliases do select. Tipagem precisa do
 * valor de cada alias (number para count/sum, tipo da coluna para a chave) é
 * fast-follow — o esqueleto devolve valores frouxos.
 */
export type AggregateRow = Record<string, unknown>;

/**
 * Saída do `aggregate`, auto-ajustada ao input (igual o `expand`): sem `facets` no
 * input → `AggregateRow[]` puro; COM `facets` → `{ rows, facets: { <nome>: linhas } }`.
 * Assim o call-site que não pede breakdown não paga o embrulho.
 */
export type AggregateOutput<I> = I extends { facets: infer F }
  ? { rows: AggregateRow[]; facets: { [K in keyof F]: AggregateRow[] } }
  : AggregateRow[];
