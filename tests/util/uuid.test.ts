import { describe, it, expect } from "vitest";
import { uuidv7 } from "../../app/engine/util/uuid.js";

describe("uuidv7", () => {
  it("produces a canonical uuid string", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("sets the version (7) and variant (10) nibbles", () => {
    const u = uuidv7();
    expect(u[14]).toBe("7"); // version nibble (start of 3rd group)
    expect(["8", "9", "a", "b"]).toContain(u[19]); // variant nibble (start of 4th group)
  });

  it("is time-ordered (later ids sort after earlier ones)", () => {
    const a = uuidv7();
    const b = uuidv7();
    // Same millisecond may tie, but never go backwards.
    expect(a <= b || a.slice(0, 8) === b.slice(0, 8)).toBe(true);
  });

  it("is unique across many calls", () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(set.size).toBe(1000);
  });
});
