import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineEntity, text, int4, reference, weave, type Weave } from "../../app/engine/index.js";

// Extensões do Estágio 2 da padronização no WhereInput:
//  - orderBy por CAMINHO ANINHADO (reference N:1) — subquery correlata;
//  - where por createdAt/updatedAt (campos gerenciados).
const category = defineEntity("owext_category", { name: text().notNull() });
const product = defineEntity("owext_product", {
  name: text().notNull(),
  price: int4().notNull(),
  category: reference(category),
});

describe("orderBy aninhado + where por timestamp", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url: DATABASE_URL, entities: { category, product } });
    await db.sql`drop table if exists owext_product, owext_category cascade`;
    await db.sync();
    const apparel = await db.save(category, { name: "Apparel" });
    const zen = await db.save(category, { name: "Zen" });
    await db.save(product, { name: "p1", price: 10, categoryId: zen.id }); // Zen
    await db.save(product, { name: "p2", price: 20, categoryId: apparel.id }); // Apparel
  });

  afterAll(async () => {
    await db.close();
  });

  it("ordena por category.name (reference N:1 aninhada)", async () => {
    const asc = await db.find(product, { orderBy: { category: { name: "asc" } } });
    expect(asc.map((p) => p.name)).toEqual(["p2", "p1"]); // Apparel < Zen
    const desc = await db.find(product, { orderBy: { category: { name: "desc" } } });
    expect(desc.map((p) => p.name)).toEqual(["p1", "p2"]);
  });

  it("filtra por createdAt (campo gerenciado no where)", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const all = await db.find(product, { where: { createdAt: { lte: future } } });
    expect(all.length).toBe(2);
    const none = await db.find(product, { where: { createdAt: { gte: future } } });
    expect(none.length).toBe(0);
  });
});
