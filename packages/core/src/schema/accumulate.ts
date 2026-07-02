// Ops de ESCRITA do tier histórico (accumulate). Diferente dos acumuladores de
// LEITURA (aggregate: count/sum/…): aqui cada op é um merge que roda NO POSTGRES,
// dentro do `ON CONFLICT DO UPDATE` — a acumulação é atômica, nunca em JS. `max`/`min`
// são overloaded no aggregate.ts (o mesmo nome serve read `max("field")` e write `max(v)`).

/** Marcador de op que o compilador do accumulate lê pra montar o upsert. */
export type AccumulateOp =
  | { readonly op: "inc"; readonly by: number } // col = col + by
  | { readonly op: "max"; readonly value: number } // col = greatest(col, value)
  | { readonly op: "min"; readonly value: number } // col = least(col, value)
  | { readonly op: "setOnInsert"; readonly value: unknown }; // grava só no INSERT; preserva no conflito

/** Incrementa (soma) — contador/soma monotônico. Default `+1`. */
export const inc = (by = 1): AccumulateOp => ({ op: "inc", by });

/** Grava só na INSERÇÃO; no conflito preserva o valor existente (ex.: `ts` do bucket). */
export const setOnInsert = (value: unknown): AccumulateOp => ({ op: "setOnInsert", value });

/** Entrada do `accumulate(key, ops)`: `key` = colunas do `ON CONFLICT` (o unique
 *  declarado); `ops` = `campo → op`. */
export interface AccumulateInput {
  readonly key: Record<string, unknown>;
  readonly ops: Record<string, AccumulateOp>;
}
