import { describe, it, expect } from "vitest";
import { array, defineEntity, int4, text } from "../../src/index.js";

describe("column builder", () => {
  it("starts nullable, scalar, no default", () => {
    const c = text();
    expect(c.config.pgType.name).toBe("text");
    expect(c.config.isArray).toBe(false);
    expect(c.config.notNull).toBe(false);
    expect(c.config.hasDefault).toBe(false);
    expect(c.config.unique).toBe(false);
    expect(c.config.index).toBe(false);
  });

  it("is immutable — modifiers return a new column", () => {
    const base = text();
    const notNull = base.notNull();
    expect(notNull).not.toBe(base);
    expect(base.config.notNull).toBe(false); // original untouched
    expect(notNull.config.notNull).toBe(true);
  });

  it("chains modifiers into config", () => {
    const c = text().notNull().unique().index().default("x");
    expect(c.config.notNull).toBe(true);
    expect(c.config.unique).toBe(true);
    expect(c.config.index).toBe(true);
    expect(c.config.hasDefault).toBe(true);
    expect(c.config.default).toBe("x");
  });

  it("nullable() reverses notNull()", () => {
    const c = int4().notNull().nullable();
    expect(c.config.notNull).toBe(false);
  });
});

describe("array()", () => {
  it("defaults to NOT NULL DEFAULT '{}'", () => {
    const c = array(text());
    expect(c.config.isArray).toBe(true);
    expect(c.config.notNull).toBe(true);
    expect(c.config.hasDefault).toBe(true);
    expect(c.config.default).toEqual([]);
    expect(c.config.pgType.name).toBe("text"); // element type
  });

  it("can be made nullable explicitly", () => {
    const c = array(text()).nullable();
    expect(c.config.notNull).toBe(false);
  });
});

describe("defineEntity", () => {
  it("captures name and user columns", () => {
    const user = defineEntity("users", {
      name: text().notNull(),
      bio: text(),
    });
    expect(user.name).toBe("users");
    expect(Object.keys(user.columns)).toEqual(["name", "bio"]);
    expect(user.columns.name.config.notNull).toBe(true);
    expect(user.columns.bio.config.notNull).toBe(false);
  });
});
