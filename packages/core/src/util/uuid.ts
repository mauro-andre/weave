/**
 * UUID v7 generation (app-side).
 *
 * Weave generates ids in TS so it works on any modern Postgres (13+), not just
 * 18 (whose native `uuidv7()` we'd otherwise depend on). The column keeps a
 * `gen_random_uuid()` default as a safety net for non-Weave inserts.
 *
 * Layout (RFC 9562): 48-bit Unix-ms timestamp, version `7`, variant `10`, the
 * rest random — so ids are time-ordered for index locality.
 *
 * Usa Web Crypto (`globalThis.crypto`) — portável: roda em Node 20+ e no browser,
 * pois o `core` é importado dos dois lados.
 */

export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  // 48-bit big-endian millisecond timestamp in bytes 0..5.
  let ts = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
