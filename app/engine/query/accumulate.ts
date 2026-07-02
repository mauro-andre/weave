/**
 * Accumulate compiler — a escrita do TIER HISTÓRICO (rollup mergeável).
 *
 * `accumulate(key, ops)` compila num ÚNICO upsert atômico:
 *
 *   INSERT INTO t (id, <keyCols>, <opCols>) VALUES (…)
 *   ON CONFLICT (<keyCols>) DO UPDATE SET <merges>, updated_at = now()
 *   RETURNING *
 *
 * A acumulação acontece NO POSTGRES (`+` / `greatest` / `least`), nunca em JS —
 * sem read-modify-write, sem corrida. Ops:
 *   - inc(n)         → col = t.col + excluded.col   (contador/soma monotônico)
 *   - max(v)/min(v)  → col = greatest/least(...)     (pico/vale — sketch numérico, §0)
 *   - setOnInsert(v) → grava só no INSERT; FORA do SET (preserva no conflito)
 *
 * O `ON CONFLICT` precisa de um árbitro: a `key` tem que casar com um UNIQUE
 * declarado — um grupo composto (`unique: [[...]]`, §5) OU uma coluna `.unique()`.
 * Ler deriva a média (`sum/count`) na leitura; nunca se guarda média pronta (§0).
 */

import { Column, Reference, camelToSnake, uuidv7, type Entity, type ShapeRecord, type AccumulateOp } from "@mauroandre/weave-core";

export interface CompiledAccumulate {
  text: string;
  params: unknown[];
}

/** Coluna de um campo (managed | escalar | reference N:1), validada contra o shape. */
function accColumn(shape: ShapeRecord, field: string): string {
  if (field === "id") return "id";
  if (field === "createdAt") return "created_at";
  if (field === "updatedAt") return "updated_at";
  const node = (shape as Record<string, unknown>)[field];
  if (node instanceof Column) return camelToSnake(field);
  if (node instanceof Reference && node.cardinality === "one") return `${camelToSnake(field)}_id`;
  throw new Error(`weave: accumulate — unknown or non-column field '${field}'.`);
}

// A `key` tem que casar com um UNIQUE declarado (o árbitro do ON CONFLICT). Aceita
// um grupo composto (options.unique) com o MESMO conjunto de campos, ou — chave de
// um campo só — uma coluna marcada `.unique()`.
function assertUniqueKey(entity: Entity<string, ShapeRecord>, keyFields: string[]): void {
  const want = new Set(keyFields);
  const sameSet = (g: string[]) => g.length === want.size && g.every((f) => want.has(f));
  if ((entity.options?.unique ?? []).some(sameSet)) return;
  if (keyFields.length === 1) {
    const node = (entity.columns as Record<string, unknown>)[keyFields[0]!];
    if (node instanceof Column && node.config.unique) return;
  }
  throw new Error(
    `weave: accumulate on '${entity.name}' needs a unique key on [${keyFields.join(", ")}]. ` +
      `Declare it with unique: [[${keyFields.map((f) => `"${f}"`).join(", ")}]] on the entity.`,
  );
}

function opInsertValue(op: AccumulateOp): unknown {
  switch (op.op) {
    case "inc":
      return op.by;
    case "max":
    case "min":
    case "setOnInsert":
      return op.value;
  }
}

// O merge do `DO UPDATE SET`. `setOnInsert` NÃO entra (preserva o valor no conflito).
function mergeExpr(table: string, col: string, op: AccumulateOp): string | null {
  switch (op.op) {
    case "inc":
      return `${col} = ${table}.${col} + excluded.${col}`;
    case "max":
      return `${col} = greatest(${table}.${col}, excluded.${col})`;
    case "min":
      return `${col} = least(${table}.${col}, excluded.${col})`;
    case "setOnInsert":
      return null;
  }
}

/** Compila `accumulate(key, ops)` no upsert atômico. Params na ordem das colunas. */
export function compileAccumulate<E extends Entity<string, ShapeRecord>>(
  entity: E,
  key: Record<string, unknown>,
  ops: Record<string, AccumulateOp>,
): CompiledAccumulate {
  const table = entity.name;
  const shape = entity.columns;
  const keyFields = Object.keys(key);
  if (keyFields.length === 0) throw new Error("weave: accumulate needs a non-empty key.");
  assertUniqueKey(entity, keyFields);

  const keyCols = keyFields.map((f) => accColumn(shape, f));
  const keyColSet = new Set(keyCols);

  // id gerado app-side (funciona em qualquer Postgres); no conflito, preserva o id.
  const columns: string[] = ["id", ...keyCols];
  const params: unknown[] = [uuidv7(), ...keyFields.map((f) => key[f])];
  const updates: string[] = [];

  for (const [field, op] of Object.entries(ops)) {
    if (!op || typeof op !== "object" || !("op" in op)) {
      throw new Error(`weave: accumulate field '${field}' needs an op (inc/max/min/setOnInsert).`);
    }
    const col = accColumn(shape, field);
    // Um campo que também é chave (ex.: `ts`) já é gravado no INSERT e preservado no
    // conflito — um `setOnInsert` redundante sobre ele é no-op; pula pra não duplicar coluna.
    if (keyColSet.has(col)) continue;
    columns.push(col);
    params.push(opInsertValue(op));
    const merge = mergeExpr(table, col, op);
    if (merge) updates.push(merge);
  }

  updates.push("updated_at = now()"); // toca a linha mesmo quando só há setOnInsert
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const text =
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ` +
    `ON CONFLICT (${keyCols.join(", ")}) DO UPDATE SET ${updates.join(", ")} RETURNING *`;
  return { text, params };
}
