import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, int4, reference } from "@mauroandre/weave-sdk";

// Entities-as-code, exatamente como o dev escreveria. Nomes únicos (banco compartilhado).
const category = defineEntity("sdkcat", { name: text().notNull() });
const product = defineEntity("sdkprod", {
  name: text().notNull(),
  price: int4().notNull(),
  category: reference(category),
});
const entities = { sdkcat: category, sdkprod: product };

describe("SDK client (F1) — CRUD tipado via app.hono.fetch", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";

  // O `fetch` injetado: manda o Request direto pro app Hono em memória (sem rede).
  const weave = () =>
    createClient({ url: "http://localhost", key, entities, fetch: (req) => app.hono.fetch(req) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS sdkprod, sdkcat CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('sdkprod','sdkcat')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "sdkcat",
          fields: { name: { kind: "column", type: "text", notNull: true } },
        });
        await applyEntity({
          irVersion: 1,
          name: "sdkprod",
          fields: {
            name: { kind: "column", type: "text", notNull: true },
            price: { kind: "column", type: "int4", notNull: true },
            category: { kind: "reference", target: "sdkcat", cardinality: "one" },
          },
        });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "sdk test key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  const NO_MATCH = "00000000-0000-0000-0000-000000000000";

  it("create + findOne por id (shorthand { id }); createdAt vira Date", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Electronics" });
    expect(cat.id).toBeTruthy();
    expect(cat.name).toBe("Electronics");
    expect(cat.createdAt).toBeInstanceOf(Date);

    const got = await w.sdkcat.findOne({ id: cat.id }); // { id } = { id: { eq } }
    expect(got?.name).toBe("Electronics");
    expect(got?.createdAt).toBeInstanceOf(Date);
  });

  it("findMany / findOne por where cru (shorthand eq)", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Books" });
    const p = await w.sdkprod.create({ name: "Clean Code", price: 80, categoryId: cat.id });
    expect(p.categoryId).toBe(cat.id);

    const all = await w.sdkprod.findMany();
    expect(all.some((x) => x.name === "Clean Code")).toBe(true);

    const one = await w.sdkprod.findOne({ name: "Clean Code" }); // shorthand
    expect(one?.price).toBe(80);
  });

  it("expand no 2º arg (opts): o retorno se auto-tipa", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Comics" });
    await w.sdkprod.create({ name: "Watchmen", price: 30, categoryId: cat.id });

    const found = await w.sdkprod.findMany({ name: "Watchmen" }, { expand: { category: true } });
    const p = found[0]!;
    expect(p.categoryId).toBe(cat.id);
    expect(p.category?.name).toBe("Comics");
    expect(p.category?.createdAt).toBeInstanceOf(Date);
  });

  it("sem expand: reference vem só como id", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Sci-Fi" });
    await w.sdkprod.create({ name: "Dune", price: 40, categoryId: cat.id });

    const found = await w.sdkprod.findMany({ name: "Dune" });
    const p = found[0]! as Record<string, unknown>;
    expect(p["categoryId"]).toBe(cat.id);
    expect("category" in p).toBe(false);
  });

  it("where com operadores + orderBy (opts)", async () => {
    const w = weave();
    await w.sdkprod.create({ name: "cheap", price: 5 });
    await w.sdkprod.create({ name: "mid", price: 50 });
    await w.sdkprod.create({ name: "pricey", price: 500 });

    const found = await w.sdkprod.findMany({ price: { gte: 50 } }, { orderBy: { price: "desc" } });
    const prices = found.map((p) => p.price);
    expect(found.every((p) => p.price >= 50)).toBe(true);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it("updateOne por where faz merge e devolve o objeto; null se não casa", async () => {
    const w = weave();
    const p = await w.sdkprod.create({ name: "Widget", price: 10 });
    const upd = await w.sdkprod.updateOne({ id: p.id }, { price: 99 });
    expect(upd?.price).toBe(99);
    expect(upd?.name).toBe("Widget"); // merge preserva o omitido
    expect(await w.sdkprod.updateOne({ id: NO_MATCH }, { price: 1 })).toBeNull();
  });

  it("updateMany por where → { count } e aplica em todos", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "BulkUpd" });
    await w.sdkprod.create({ name: "bu1", price: 1, categoryId: cat.id });
    await w.sdkprod.create({ name: "bu2", price: 1, categoryId: cat.id });

    const res = await w.sdkprod.updateMany({ categoryId: cat.id }, { price: 7 });
    expect(res.count).toBe(2);
    const after = await w.sdkprod.findMany({ categoryId: cat.id });
    expect(after.every((p) => p.price === 7)).toBe(true);
  });

  it("deleteOne devolve o objeto deletado; null se não casa", async () => {
    const w = weave();
    const p = await w.sdkprod.create({ name: "Temp", price: 1 });
    const del = await w.sdkprod.deleteOne({ id: p.id });
    expect(del?.id).toBe(p.id);
    expect(await w.sdkprod.findOne({ id: p.id })).toBeNull();
    expect(await w.sdkprod.deleteOne({ id: p.id })).toBeNull(); // já não existe
  });

  it("deleteMany por where → { count }", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "BulkDel" });
    await w.sdkprod.create({ name: "bd1", price: 1, categoryId: cat.id });
    await w.sdkprod.create({ name: "bd2", price: 1, categoryId: cat.id });

    const res = await w.sdkprod.deleteMany({ categoryId: cat.id });
    expect(res.count).toBe(2);
    expect(await w.sdkprod.findMany({ categoryId: cat.id })).toHaveLength(0);
  });

  it("update/delete exigem where (guarda contra mutação em massa acidental)", async () => {
    const w = weave();
    await expect(w.sdkprod.updateMany({}, { price: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(w.sdkprod.deleteMany({})).rejects.toMatchObject({ status: 400 });
  });

  it("paginate(where, { perPage })", async () => {
    const w = weave();
    const page = await w.sdkcat.paginate({}, { perPage: 5 });
    expect(Array.isArray(page.docs)).toBe(true);
    expect(typeof page.docsQuantity).toBe("number");
  });

  it("erro tipado: key inválida → 401", async () => {
    const bad = createClient({
      url: "http://localhost",
      key: "weave_sk_nope",
      entities,
      fetch: (req) => app.hono.fetch(req),
    });
    await expect(bad.sdkcat.findMany()).rejects.toMatchObject({ status: 401 });
  });
});
