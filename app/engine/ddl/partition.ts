/**
 * Partição por tempo (RANGE nativo do Postgres) — matemática de bucket + render de
 * DDL. **Puro** (sem DB): o control-plane usa isto pra garantir/dropar partição.
 *
 * O único "JS" do mecanismo é aritmética de fronteira (epoch-floor, o mesmo do
 * `timeBucket` do aggregate); criar/dropar é DDL nativa idempotente. Genérico —
 * serve qualquer entity de série-temporal (logs, auditoria, eventos), não só
 * telemetria.
 */

/** "1d"→86400 · "30d"→2592000 · "5min"→300 · "30s"→30 · "1h"→3600. Serve interval E retention. */
export function parseDuration(spec: string): number {
  const m = /^(\d+)(s|min|h|d)$/.exec(spec.trim());
  if (!m) throw new Error(`weave: invalid duration '${spec}' (use 30s, 5min, 1h, 1d, 30d).`);
  const unit = { s: 1, min: 60, h: 3600, d: 86400 }[m[2] as "s" | "min" | "h" | "d"];
  return Number(m[1]) * unit;
}

/** Início do bucket que contém `epochSec` (epoch-floor, alinhado por UTC). */
export function bucketStart(epochSec: number, intervalSec: number): number {
  return Math.floor(epochSec / intervalSec) * intervalSec;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Sufixo legível do nome da partição, com granularidade casada ao intervalo:
 * ≥1d→`YYYY_MM_DD` · ≥1h→`…_HH` · ≥1min→`…_HHMM` · else→`…_HHMMSS` (tudo UTC).
 */
export function partitionSuffix(startEpochSec: number, intervalSec: number): string {
  const d = new Date(startEpochSec * 1000);
  const day = `${d.getUTCFullYear()}_${pad(d.getUTCMonth() + 1)}_${pad(d.getUTCDate())}`;
  if (intervalSec >= 86400) return day;
  if (intervalSec >= 3600) return `${day}_${pad(d.getUTCHours())}`;
  if (intervalSec >= 60) return `${day}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${day}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** Nome determinístico da partição de um bucket: `<tabela>_<sufixo>`. */
export function partitionName(table: string, startEpochSec: number, intervalSec: number): string {
  return `${table}_${partitionSuffix(startEpochSec, intervalSec)}`;
}

/** `CREATE TABLE IF NOT EXISTS … PARTITION OF … FOR VALUES FROM (start) TO (end)` — idempotente. */
export function renderCreatePartition(
  parent: string,
  name: string,
  startEpochSec: number,
  intervalSec: number,
): string {
  const start = new Date(startEpochSec * 1000).toISOString();
  const end = new Date((startEpochSec + intervalSec) * 1000).toISOString();
  return `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${parent} FOR VALUES FROM ('${start}') TO ('${end}');`;
}

/** `DROP TABLE IF EXISTS <partição>` — o drop de uma partição inteira (não `DELETE`). */
export function renderDropPartition(name: string): string {
  return `DROP TABLE IF EXISTS ${name};`;
}

/**
 * Lista as partições reais de um pai + o limite SUPERIOR de cada uma (do catálogo,
 * não do nome — robusto a restart). `$1` = nome do pai. O `pg_get_expr(relpartbound)`
 * devolve `FOR VALUES FROM ('…') TO ('…')`; o control-plane extrai o `TO` e dropa
 * as cujo topo já passou da retenção.
 */
export const LIST_PARTITIONS_SQL =
  `SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bounds ` +
  `FROM pg_inherits i ` +
  `JOIN pg_class c ON c.oid = i.inhrelid ` +
  `JOIN pg_class p ON p.oid = i.inhparent ` +
  `WHERE p.relname = $1`;

/** Extrai o limite superior (epoch seg) de um `FOR VALUES FROM ('…') TO ('…')`, ou null. */
export function upperBoundEpoch(bounds: string): number | null {
  const m = /TO \('([^']+)'\)/.exec(bounds);
  if (!m) return null;
  const t = new Date(m[1]!).getTime();
  return Number.isFinite(t) ? t / 1000 : null;
}
