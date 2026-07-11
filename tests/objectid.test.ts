import { describe, it, expect } from "vitest";
import { objectId } from "@mauroandre/weave-core";

// MongoDB-ObjectId-compatible id: byte-exact layout (4-byte second timestamp + 5-byte
// per-process random + 3-byte incrementing counter) → 24 hex. Same string shape as a real
// ObjectId, zero dependency on `bson`. Ligado por WEAVE_ID_TYPE=objectId no servidor.

describe("objectId() — 24-hex ObjectId-compatible id", () => {
  it("is 24 lowercase hex chars (passes ObjectId.isValid shape)", () => {
    expect(objectId()).toMatch(/^[0-9a-f]{24}$/);
  });

  it("is unique across a large batch", () => {
    const ids = Array.from({ length: 5000 }, () => objectId());
    expect(new Set(ids).size).toBe(5000);
  });

  it("embeds the second timestamp in the first 4 bytes (Mongo layout)", () => {
    const ts = parseInt(objectId().slice(0, 8), 16);
    expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it("per-process random (bytes 4..8) is stable; counter (last 3 bytes) increments by 1", () => {
    const a = objectId();
    const b = objectId();
    expect(a.slice(8, 18)).toBe(b.slice(8, 18)); // same 5-byte per-process random
    const ca = parseInt(a.slice(18), 16);
    const cb = parseInt(b.slice(18), 16);
    expect(cb).toBe((ca + 1) & 0xffffff); // counter +1 (wraps at 2^24) → same-second monotonic
  });
});
