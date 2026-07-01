import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { pushEntities, createClient, defineEntity, text, int4, reference } from "@mauroandre/weave-sdk";

// F3: entities.push — entities-as-code → /admin/entities (plan/apply), em ordem de
// dependência, devolvendo applied / review (plano por risco). Via app.hono.fetch.

describe("SDK entities push (F3)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const opts = () => ({ url: "http://localhost", key, fetch: (r: Request) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS pushprod, pushcat, pushacct CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('pushprod','pushcat','pushacct')`;
        await sql`DELETE FROM weave_api_keys`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "push key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("aplica em ordem de dependência (reference) e devolve applied", async () => {
    const category = defineEntity("pushcat", { name: text().notNull() });
    const product = defineEntity("pushprod", { name: text().notNull(), category: reference(category) });

    // Passa product ANTES de category de propósito — o topo-sort tem que reordenar.
    const res = await pushEntities({ product, category }, opts());
    expect(res.review).toEqual([]);
    expect(res.applied).toEqual(["pushcat", "pushprod"]); // category aplicada primeiro

    // De fato funcional: criar um product com a reference via SDK.
    const weave = createClient({ ...opts(), entities: { pushcat: category, pushprod: product } });
    const cat = await weave.pushcat.create({ name: "Books" });
    const p = await weave.pushprod.create({ name: "Clean Code", categoryId: cat.id });
    expect(p.categoryId).toBe(cat.id);
  });

  it("re-push idempotente (nada a mudar) → applied, zero review", async () => {
    const acct = defineEntity("pushacct", { label: text() });
    expect((await pushEntities({ acct }, opts())).applied).toEqual(["pushacct"]);
    const again = await pushEntities({ acct }, opts());
    expect(again.applied).toEqual(["pushacct"]);
    expect(again.review).toEqual([]);
  });

  it("rename: injeta o id do campo antigo → o servidor vê RENAME (dado preservado)", async () => {
    const v1 = defineEntity("pushren", { name: text().notNull(), price: int4() });
    await pushEntities({ x: v1 }, opts());
    const w1 = createClient({ ...opts(), entities: { pushren: v1 } });
    const row = await w1.pushren.create({ name: "Widget", price: 10 });

    // renomeia `name` → `title` no código + diz que é rename
    const v2 = defineEntity("pushren", { title: text().notNull(), price: int4() });
    const res = await pushEntities({ x: v2 }, { ...opts(), renames: { pushren: { name: "title" } } });
    expect(res.applied).toContain("pushren");
    expect(res.review).toEqual([]); // rename é seguro (não vira drop+add)

    // o dado sobreviveu: a linha agora tem `title` = "Widget"
    const w2 = createClient({ ...opts(), entities: { pushren: v2 } });
    const got = (await w2.pushren.findOne({ id: row.id })) as { title?: string; price?: number } | null;
    expect(got?.title).toBe("Widget");
    expect(got?.price).toBe(10);
  });

  it("🟡 mudança que precisa de valor → review com plano; fill → applied", async () => {
    // pushacct.label já existe (nullable) do teste anterior. Cria uma linha NULL.
    const weave = createClient({ ...opts(), entities: { pushacct: defineEntity("pushacct", { label: text() }) } });
    await weave.pushacct.create({}); // label = NULL

    const acctNN = defineEntity("pushacct", { label: text().notNull() });
    const review = await pushEntities({ acct: acctNN }, opts());
    expect(review.applied).not.toContain("pushacct");
    const plan = review.review.find((r) => r.name === "pushacct")!;
    expect(plan.plan.changes.some((c) => c.risk === "needsValue")).toBe(true);

    const applied = await pushEntities({ acct: acctNN }, { ...opts(), fill: { pushacct: { label: "filled" } } });
    expect(applied.applied).toContain("pushacct");
    expect(applied.review).toEqual([]);
  });
});
