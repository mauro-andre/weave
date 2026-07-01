import type { Entity, ShapeRecord } from "./entity.js";
import type { WhereInput, SortDir } from "./where.js";

// Linguagem de AGREGAÇÃO em idioma de objeto (irmã do WhereInput). O dev monta
// `groupBy` + acumuladores no `select` + `orderBy`; o engine (compileAggregate)
// compila num `SELECT … GROUP BY … ORDER BY`. Os helpers (count/sum/…, timeBucket)
// produzem marcadores que o compilador lê. Primeiro tijolo: count/sum/avg/min/max +
// groupBy (campo | timeBucket) + orderBy. (percentile/histogram/having/facets = depois.)

/** Acumulador: marcador que o compilador lê. `count()` não tem campo; o resto tem. */
export type Accumulator =
  | { readonly agg: "count" }
  | { readonly agg: "sum" | "avg" | "min" | "max"; readonly field: string };

export const count = (): Accumulator => ({ agg: "count" });
export const sum = (field: string): Accumulator => ({ agg: "sum", field });
export const avg = (field: string): Accumulator => ({ agg: "avg", field });
export const min = (field: string): Accumulator => ({ agg: "min", field });
export const max = (field: string): Accumulator => ({ agg: "max", field });

/** Expressão de grupo por tempo — trunca `field` em baldes de `interval` (epoch/UTC). */
export type GroupExpr = { readonly timeBucket: { readonly field: string; readonly interval: string } };
export const timeBucket = (field: string, interval: string): GroupExpr => ({ timeBucket: { field, interval } });

/**
 * Entrada do `aggregate`. `groupBy`: array de campos (chaves homônimas) OU mapa
 * `alias → campo | expr`. `select`: `alias → acumulador`. `orderBy`: por alias do
 * select OU chave de grupo. `where` é o mesmo `WhereInput` do find.
 */
export interface AggregateInput<E extends Entity<string, ShapeRecord>> {
  where?: WhereInput<E>;
  groupBy?: string[] | Record<string, string | GroupExpr>;
  select: Record<string, Accumulator>;
  orderBy?: Record<string, SortDir>;
}

/**
 * Uma linha agregada: chaves de grupo + aliases do select. Tipagem precisa do
 * valor de cada alias (number para count/sum, tipo da coluna para a chave) é
 * fast-follow — o esqueleto devolve valores frouxos.
 */
export type AggregateRow = Record<string, unknown>;
