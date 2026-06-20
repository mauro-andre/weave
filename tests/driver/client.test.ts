import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { array, defineEntity, int4, text, weave, type Weave } from "../../src/index.js";

/**
 * Integration tests — require the Postgres from docker-compose.
 * Opt out with WEAVE_NO_DB=1 (e.g. in an environment without the container).
 */
const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

const products = defineEntity("weave_it_products", {
  name: text().notNull(),
  price: int4().notNull().default(0),
  tags: array(text()),
  sku: text().notNull().index(),
});

const categories = defineEntity("weave_it_categories", {
  label: text().notNull().unique(),
});

describe.skipIf(noDb)("driver", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { products, categories } });
    // clean slate
    await db.sql`drop table if exists weave_it_products, weave_it_categories`;
  });

  afterAll(async () => {
    await db.sql`drop table if exists weave_it_products, weave_it_categories`;
    await db.close();
  });

  it("sync() creates the registered tables", async () => {
    const result = await db.sync();
    expect(result.created.sort()).toEqual([
      "weave_it_categories",
      "weave_it_products",
    ]);
    expect(result.warnings).toEqual([]);

    const rows = await db.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name like 'weave_it_%'
    `;
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      "weave_it_categories",
      "weave_it_products",
    ]);
  });

  it("sync() is idempotent — second run is a no-op", async () => {
    const result = await db.sync();
    expect(result.created).toEqual([]);
    expect(result.columnsAdded).toEqual([]);
    expect(result.indexesAdded).toEqual([]);
  });

  it("the table works end to end (defaults, array, uuid v7)", async () => {
    await db.sql`insert into weave_it_products (name, sku) values ('Widget', 'W-1')`;
    const [row] = await db.sql<
      { id: string; name: string; price: number; tags: string[] }[]
    >`select id, name, price, tags from weave_it_products where sku = 'W-1'`;

    expect(row?.name).toBe("Widget");
    expect(row?.price).toBe(0); // default
    expect(row?.tags).toEqual([]); // array NOT NULL DEFAULT '{}'
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/); // uuid v7
  });

  it("transaction() rolls back on throw", async () => {
    const sentinel = "rollback-me";
    await expect(
      db.transaction(async (tx) => {
        await tx`insert into weave_it_categories (label) values (${sentinel})`;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await db.sql`
      select 1 from weave_it_categories where label = ${sentinel}
    `;
    expect(rows.length).toBe(0); // insert was rolled back
  });
});
