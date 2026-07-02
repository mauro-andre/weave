// Manutenção de partição por tempo — INTERNA ao Weave (o app só declara `partitionBy`
// + `retention`; nunca vê nem agenda nada). Lazy no write: garante a partição da `ts`
// que CHEGA (cobre backlog atrasado) e, ao abrir um bucket novo, dropa as expiradas.
// Self-clocking pelo tráfego — sem cron, sem endpoint. Postgres-nativo (CREATE/DROP
// idempotente); o único JS é aritmética de bucket.

import {
  bucketStart,
  partitionName,
  renderCreatePartition,
  renderDropPartition,
  LIST_PARTITIONS_SQL,
  upperBoundEpoch,
} from "../ddl/partition.js";

interface SqlUnsafe {
  unsafe(q: string, p?: unknown[]): Promise<unknown[]>;
}

// Cache por-processo das partições já garantidas (table → set de inícios de bucket).
// Evita a DDL repetida no hot path: depois do 1º write do bucket, os próximos pulam.
const ensured = new Map<string, Set<number>>();

/** Só pros testes: zera o cache entre cenários. */
export function __resetPartitionCache(): void {
  ensured.clear();
}

export interface PartitionResult {
  /** Por input, na ordem: `false` = pulado por retenção (ts além da janela). */
  keep: boolean[];
  /** Quantos foram pulados por retenção (pro chamador logar — diagnóstico de relógio torto). */
  skipped: number;
}

/**
 * Garante as partições dos `tsEpochs` que chegam e dropa as expiradas (se um bucket
 * novo abriu). Devolve o `keep[]` — linhas com `ts < now - retention` são puladas
 * (partição já não existe; guardá-las seria criar-pra-dropar).
 */
export async function maintainPartitions(
  sql: SqlUnsafe,
  table: string,
  intervalSec: number,
  retentionSec: number | null,
  tsEpochs: number[],
): Promise<PartitionResult> {
  const cutoff = retentionSec != null ? Date.now() / 1000 - retentionSec : -Infinity;

  const keep: boolean[] = [];
  const buckets = new Set<number>();
  let skipped = 0;
  for (const ts of tsEpochs) {
    if (ts < cutoff) {
      keep.push(false);
      skipped++;
      continue;
    }
    keep.push(true);
    buckets.add(bucketStart(ts, intervalSec));
  }

  const known = ensured.get(table) ?? new Set<number>();
  ensured.set(table, known);
  let openedNew = false;
  for (const b of buckets) {
    if (known.has(b)) continue;
    await sql.unsafe(renderCreatePartition(table, partitionName(table, b, intervalSec), b, intervalSec));
    known.add(b);
    openedNew = true;
  }

  // Drop das expiradas colado no rollover: só quando um bucket NOVO abre (≈1×/dia sob
  // tráfego vivo) — self-clocking, sem scheduler. Lê os limites do catálogo (robusto a
  // restart), não do cache.
  if (openedNew && retentionSec != null) await dropExpired(sql, table, cutoff);

  return { keep, skipped };
}

async function dropExpired(sql: SqlUnsafe, table: string, cutoffSec: number): Promise<void> {
  const rows = (await sql.unsafe(LIST_PARTITIONS_SQL, [table])) as { name: string; bounds: string }[];
  for (const r of rows) {
    const upper = upperBoundEpoch(r.bounds);
    if (upper != null && upper <= cutoffSec) await sql.unsafe(renderDropPartition(r.name));
  }
}
