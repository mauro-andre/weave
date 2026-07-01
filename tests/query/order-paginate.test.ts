import { describe, it, expect } from "vitest";
import { compileCount, compileFind, defineEntity, int4, text } from "../../app/engine/index.js";

const user = defineEntity("users", { name: text().notNull(), age: int4() });

describe("compileFind orderBy / limit / offset", () => {
  it("defaults to created_at when no orderBy", () => {
    expect(compileFind(user).text).toContain("ORDER BY users.created_at");
  });

  it("renders multi-column orderBy in insertion order", () => {
    const sql = compileFind(user, { orderBy: { age: "desc", name: "asc" } }).text;
    expect(sql).toContain("ORDER BY users.age DESC, users.name ASC");
  });

  it("parameterizes limit and offset", () => {
    const { text: sql, params } = compileFind(user, {
      where: { name: "x" },
      limit: 10,
      offset: 20,
    });
    expect(sql).toContain("LIMIT $2");
    expect(sql).toContain("OFFSET $3");
    expect(params).toEqual(["x", 10, 20]);
  });
});

describe("compileCount", () => {
  it("counts with no filter", () => {
    expect(compileCount(user).text).toBe("SELECT count(*)::int AS n FROM users");
    expect(compileCount(user).params).toEqual([]);
  });

  it("counts with a filter (same where compiler)", () => {
    const { text: sql, params } = compileCount(user, { age: { gte: 18 } });
    expect(sql).toBe("SELECT count(*)::int AS n FROM users WHERE users.age >= $1");
    expect(params).toEqual([18]);
  });

  it("latestPer conta GRUPOS distintos", () => {
    const { text: sql } = compileCount(user, undefined, ["name"]);
    expect(sql).toBe("SELECT count(DISTINCT (users.name))::int AS n FROM users");
  });
});

describe("compileFind latestPer (DISTINCT ON — greatest-n-per-group)", () => {
  it("DISTINCT ON (cols) e prefixa as colunas do grupo no ORDER BY", () => {
    const sql = compileFind(user, { latestPer: ["name"], orderBy: { age: "desc" } }).text;
    expect(sql).toContain("SELECT DISTINCT ON (users.name)");
    // as colunas do grupo LIDERAM o ORDER BY (exigência do Postgres), depois o do user.
    expect(sql).toContain("ORDER BY users.name, users.age DESC");
  });

  it("multi-coluna: DISTINCT ON (a, b) e ambas lideram o ORDER BY", () => {
    const sql = compileFind(user, { latestPer: ["name", "age"], orderBy: { age: "desc" } }).text;
    expect(sql).toContain("SELECT DISTINCT ON (users.name, users.age)");
    expect(sql).toContain("ORDER BY users.name, users.age, users.age DESC");
  });

  it("sem latestPer: nada de DISTINCT ON (inalterado)", () => {
    expect(compileFind(user, { orderBy: { age: "desc" } }).text).not.toContain("DISTINCT ON");
  });

  it("guard: latestPer com campo desconhecido → erro (anti-injection)", () => {
    expect(() => compileFind(user, { latestPer: ['name"; DROP TABLE x; --'] })).toThrow(/unknown field/);
  });
});
