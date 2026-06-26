import { describe, it, expect } from "vitest";
import { allTypes, byName, byOid, catalog } from "@mauroandre/weave-core";

describe("registry", () => {
  it("byName resolves every catalog entry", () => {
    for (const entry of allTypes) {
      expect(byName.get(entry.name)).toBe(entry);
    }
  });

  it("byOid resolves every catalog entry", () => {
    for (const entry of allTypes) {
      expect(byOid.get(entry.oid)).toBe(entry);
    }
  });

  it("has one entry per catalog member", () => {
    const count = Object.keys(catalog).length;
    expect(allTypes.length).toBe(count);
    expect(byName.size).toBe(count);
    expect(byOid.size).toBe(count);
  });

  it("OIDs are unique (no collisions)", () => {
    const oids = allTypes.map((t) => t.oid);
    expect(new Set(oids).size).toBe(oids.length);
  });

  it("returns undefined for unknown lookups", () => {
    expect(byName.get("nonsense")).toBeUndefined();
    expect(byOid.get(999999)).toBeUndefined();
  });
});
