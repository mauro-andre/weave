import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { defineEntity, int4, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

const user = defineEntity("weave_op_users", {
  name: text().notNull(),
  age: int4(),
});

describe.skipIf(noDb)("operators (integration)", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { user } });
    await db.sql`drop table if exists weave_op_users cascade`;
    await db.sync();
    await db.save(user, { name: "Ana", age: 17 });
    await db.save(user, { name: "Bia", age: 30 });
    await db.save(user, { name: "Caio", age: 65 });
    await db.save(user, { name: "Dudu" }); // age null
  });

  afterAll(async () => {
    await db.sql`drop table if exists weave_op_users cascade`;
    await db.close();
  });

  const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

  it("gte/lt range", async () => {
    const rows = await db.find(user, { where: { age: { gte: 18, lt: 65 } } });
    expect(names(rows)).toEqual(["Bia"]);
  });

  it("in list", async () => {
    const rows = await db.find(user, { where: { age: { in: [17, 65] } } });
    expect(names(rows)).toEqual(["Ana", "Caio"]);
  });

  it("ilike", async () => {
    const rows = await db.find(user, { where: { name: { ilike: "%a%" } } });
    expect(names(rows)).toEqual(["Ana", "Bia", "Caio"]); // all contain 'a'
  });

  it("isNull", async () => {
    const rows = await db.find(user, { where: { age: { isNull: true } } });
    expect(names(rows)).toEqual(["Dudu"]);
  });

  it("or", async () => {
    const rows = await db.find(user, {
      where: { or: [{ age: { lt: 18 } }, { age: { gte: 65 } }] },
    });
    expect(names(rows)).toEqual(["Ana", "Caio"]);
  });

  it("not", async () => {
    const rows = await db.find(user, { where: { not: { age: { isNull: true } } } });
    expect(names(rows)).toEqual(["Ana", "Bia", "Caio"]);
  });
});
