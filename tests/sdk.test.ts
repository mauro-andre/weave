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

  it("create + get: round-trip, e createdAt vira Date (revive obj↔json)", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Electronics" });
    expect(cat.id).toBeTruthy();
    expect(cat.name).toBe("Electronics");
    expect(cat.createdAt).toBeInstanceOf(Date);

    const got = await w.sdkcat.get(cat.id);
    expect(got?.name).toBe("Electronics");
    expect(got?.createdAt).toBeInstanceOf(Date);
  });

  it("create com reference por categoryId; find/findOne tipados", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Books" });
    const p = await w.sdkprod.create({ name: "Clean Code", price: 80, categoryId: cat.id });
    expect(p.price).toBe(80);
    expect(p.categoryId).toBe(cat.id);

    const all = await w.sdkprod.find();
    expect(all.some((x) => x.name === "Clean Code")).toBe(true);

    const one = await w.sdkprod.findOne({ where: { name: { eq: "Clean Code" } } });
    expect(one?.price).toBe(80);
  });

  it("expand tipado: o retorno se auto-tipa pelo expand (category expandida)", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Comics" });
    await w.sdkprod.create({ name: "Watchmen", price: 30, categoryId: cat.id });

    const found = await w.sdkprod.find({
      expand: { category: true },
      where: { name: { eq: "Watchmen" } },
    });
    const p = found[0]!;
    expect(p.categoryId).toBe(cat.id);
    // `p.category` só EXISTE no tipo por causa do expand — e o revive desce nela.
    expect(p.category?.name).toBe("Comics");
    expect(p.category?.createdAt).toBeInstanceOf(Date);
  });

  it("sem expand: reference vem só como id (não auto-expande)", async () => {
    const w = weave();
    const cat = await w.sdkcat.create({ name: "Sci-Fi" });
    await w.sdkprod.create({ name: "Dune", price: 40, categoryId: cat.id });

    const found = await w.sdkprod.find({ where: { name: { eq: "Dune" } } });
    const p = found[0]! as Record<string, unknown>;
    expect(p["categoryId"]).toBe(cat.id);
    expect("category" in p).toBe(false);
  });

  it("where com operadores + orderBy tipados (caminho compileFind)", async () => {
    const w = weave();
    await w.sdkprod.create({ name: "cheap", price: 5 });
    await w.sdkprod.create({ name: "mid", price: 50 });
    await w.sdkprod.create({ name: "pricey", price: 500 });

    const found = await w.sdkprod.find({
      where: { price: { gte: 50 } },
      orderBy: { price: "desc" },
    });
    const prices = found.map((p) => p.price);
    expect(found.every((p) => p.price >= 50)).toBe(true);
    expect(prices).toEqual([...prices].sort((a, b) => b - a)); // ordenado desc
  });

  it("update faz merge (campo omitido é preservado)", async () => {
    const w = weave();
    const p = await w.sdkprod.create({ name: "Widget", price: 10 });
    const upd = await w.sdkprod.update(p.id, { price: 99 });
    expect(upd.price).toBe(99);
    expect(upd.name).toBe("Widget");
  });

  it("delete remove; get de id inexistente → null", async () => {
    const w = weave();
    const p = await w.sdkprod.create({ name: "Temp", price: 1 });
    await w.sdkprod.delete(p.id);
    expect(await w.sdkprod.get(p.id)).toBeNull();
  });

  it("paginate devolve docs + contagem", async () => {
    const w = weave();
    const page = await w.sdkcat.paginate({ perPage: 5 });
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
    await expect(bad.sdkcat.find()).rejects.toMatchObject({ status: 401 });
  });
});
