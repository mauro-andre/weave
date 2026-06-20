import { describe, it, expect } from "vitest";
import { compileFind, defineEntity, int4, text } from "../../src/index.js";

const user = defineEntity("users", {
  name: text().notNull(),
  age: int4(),
});

/** Extract just the WHERE line for convenience. */
function whereOf(opts: Parameters<typeof compileFind<typeof user>>[1]) {
  const { text: sql, params } = compileFind(user, opts);
  const line = sql.split("\n").find((l) => l.startsWith("WHERE")) ?? "";
  return { where: line.replace(/^WHERE /, ""), params };
}

describe("scalar operators", () => {
  it("bare value is eq", () => {
    expect(whereOf({ where: { name: "Mauro" } })).toEqual({
      where: "users.name = $1",
      params: ["Mauro"],
    });
  });

  it("comparison operators", () => {
    expect(whereOf({ where: { age: { gte: 18, lt: 65 } } })).toEqual({
      where: "users.age >= $1 AND users.age < $2",
      params: [18, 65],
    });
  });

  it("in / notIn expand to placeholder lists", () => {
    expect(whereOf({ where: { age: { in: [1, 2, 3] } } })).toEqual({
      where: "users.age IN ($1, $2, $3)",
      params: [1, 2, 3],
    });
  });

  it("empty in matches nothing; empty notIn matches everything", () => {
    expect(whereOf({ where: { age: { in: [] } } }).where).toBe("FALSE");
    expect(whereOf({ where: { age: { notIn: [] } } }).where).toBe("TRUE");
  });

  it("like / ilike (string only)", () => {
    expect(whereOf({ where: { name: { ilike: "%mau%" } } })).toEqual({
      where: "users.name ILIKE $1",
      params: ["%mau%"],
    });
  });

  it("isNull renders IS [NOT] NULL with no param", () => {
    expect(whereOf({ where: { age: { isNull: true } } })).toEqual({
      where: "users.age IS NULL",
      params: [],
    });
    expect(whereOf({ where: { age: { isNull: false } } }).where).toBe("users.age IS NOT NULL");
  });

  it("eq null becomes IS NULL", () => {
    expect(whereOf({ where: { age: { eq: null } } }).where).toBe("users.age IS NULL");
  });
});

describe("logical operators", () => {
  it("and / or group conditions", () => {
    const { where, params } = whereOf({
      where: { or: [{ name: "A" }, { age: { gt: 30 } }] },
    });
    expect(where).toBe("(users.name = $1 OR users.age > $2)");
    expect(params).toEqual(["A", 30]);
  });

  it("not negates", () => {
    expect(whereOf({ where: { not: { name: "A" } } }).where).toBe("NOT (users.name = $1)");
  });

  it("top-level keys are AND-combined", () => {
    expect(whereOf({ where: { name: "A", age: { gt: 1 } } }).where).toBe(
      "users.name = $1 AND users.age > $2",
    );
  });
});
