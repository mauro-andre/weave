import type { Entity, ShapeRecord } from "./entity.js";
import type { WhereInput, SortDir } from "./where.js";

// Linguagem de AGREGAÇÃO em idioma de objeto (irmã do WhereInput). O dev monta
// `groupBy` + acumuladores no `select` + `orderBy`; o engine (compileAggregate)
// compila num `SELECT … GROUP BY … HAVING … ORDER BY`. Os helpers (count/sum/…,
// timeBucket) produzem marcadores que o compilador lê. Coberto: count/sum/avg/min/max
// + distinct + percentile (exato) + `{ where }` por acumulador (→ FILTER) + groupBy
// (campo | timeBucket) + having + orderBy. (histogram/hll/facets/expressões = depois.)

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
export const min = (field: string, opts?: AggOpts): Accumulator => withWhere({ agg: "min", field }, opts);
export const max = (field: string, opts?: AggOpts): Accumulator => withWhere({ agg: "max", field }, opts);
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
 * Entrada do `aggregate`. `groupBy`: array de campos (chaves homônimas) OU mapa
 * `alias → campo | expr`. `select`: `alias → acumulador`. `having`: filtro sobre os
 * ALIASES do select (agregados) → `HAVING`. `orderBy`: por alias do select OU chave
 * de grupo. `page`/`perPage`: top-N paginado (pressupõe `orderBy`). `where` é o mesmo
 * `WhereInput` do find (filtra ANTES de agrupar).
 */
export interface AggregateInput<E extends Entity<string, ShapeRecord>> {
  where?: WhereInput<E>;
  groupBy?: string[] | Record<string, string | GroupExpr>;
  select: Record<string, Accumulator>;
  having?: Record<string, unknown>;
  orderBy?: Record<string, SortDir>;
  page?: number;
  perPage?: number;
}

/**
 * Uma linha agregada: chaves de grupo + aliases do select. Tipagem precisa do
 * valor de cada alias (number para count/sum, tipo da coluna para a chave) é
 * fast-follow — o esqueleto devolve valores frouxos.
 */
export type AggregateRow = Record<string, unknown>;
