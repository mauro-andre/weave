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

// ── ObjectId-compatible id (Mongo→Weave migration) ───────────────────────────
// Byte-exact MongoDB ObjectId layout (v3.4+): 4-byte second timestamp + 5-byte
// per-process random + 3-byte incrementing counter → 24 hex chars. Same STRING shape
// as a real ObjectId (passes `ObjectId.isValid`, `getTimestamp()` reads the first 4
// bytes), with zero dependency on the `bson` lib — so the `core` stays pure/portable.
// The counter keeps same-second ids monotonic (sort-by-id ≈ insertion order, like Mongo).
// Enabled server-side by `WEAVE_ID_TYPE=objectId`. Lazily initialized (no module-load
// side effects); only ever called server-side (write/accumulate).

let oidProcess: Uint8Array | undefined; // 5-byte per-process random, once
let oidCounter = -1; // 3-byte counter, starts random, wraps at 2^24

/** MongoDB-ObjectId-compatible 24-hex id. See the block comment above. */
export function objectId(): string {
  if (oidProcess === undefined) {
    const proc = new Uint8Array(5);
    globalThis.crypto.getRandomValues(proc);
    oidProcess = proc;
    const seed = new Uint8Array(3);
    globalThis.crypto.getRandomValues(seed);
    oidCounter = ((seed[0]! << 16) | (seed[1]! << 8) | seed[2]!) & 0xffffff;
  }

  const bytes = new Uint8Array(12);
  // 4-byte big-endian second timestamp.
  let ts = Math.floor(Date.now() / 1000);
  for (let i = 3; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes.set(oidProcess, 4); // 5-byte per-process random
  // 3-byte incrementing counter (wraps at 2^24).
  oidCounter = (oidCounter + 1) & 0xffffff;
  bytes[9] = (oidCounter >> 16) & 0xff;
  bytes[10] = (oidCounter >> 8) & 0xff;
  bytes[11] = oidCounter & 0xff;

  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
