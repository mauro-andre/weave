import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { defineEntity, int4, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = DATABASE_URL;

const item = defineEntity("weave_pg_items", { name: text().notNull(), n: int4().notNull() });

describe.skipIf(noDb)("orderBy / count / paginate (integration)", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { item } });
    await db.sql`drop table if exists weave_pg_items cascade`;
    await db.sync();
    for (let i = 1; i <= 25; i++) await db.save(item, { name: `i${i}`, n: i });
  });

  afterAll(async () => {
    await db.sql`drop table if exists weave_pg_items cascade`;
    await db.close();
  });

  it("orderBy desc + limit", async () => {
    const rows = await db.find(item, { orderBy: { n: "desc" }, limit: 3 });
    expect(rows.map((r) => r.n)).toEqual([25, 24, 23]);
  });

  it("count respects the filter", async () => {
    expect(await db.count(item)).toBe(25);
    expect(await db.count(item, { where: { n: { gt: 20 } } })).toBe(5);
  });

  it("paginate returns docs + totals (zodmongo ergonomics)", async () => {
    const page = await db.paginate(item, {
      orderBy: { n: "asc" },
      page: 2,
      perPage: 10,
    });
    expect(page.docsQuantity).toBe(25);
    expect(page.pageQuantity).toBe(3);
    expect(page.currentPage).toBe(2);
    expect(page.docs).toHaveLength(10);
    expect(page.docs.map((d) => d.n)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("paginate honors the where filter in both docs and totals", async () => {
    const page = await db.paginate(item, {
      where: { n: { gt: 20 } },
      orderBy: { n: "asc" },
      perPage: 2,
    });
    expect(page.docsQuantity).toBe(5);
    expect(page.pageQuantity).toBe(3);
    expect(page.docs.map((d) => d.n)).toEqual([21, 22]);
  });
});
