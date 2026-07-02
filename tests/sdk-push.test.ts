import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { pushEntities, genProject, createClient, defineEntity, text, int4, reference } from "@mauroandre/weave-sdk";

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
        await sql`DROP TABLE IF EXISTS pushprod, pushcat, pushacct, pushreg, pushstack, backup_storages, static_deploys CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('pushprod','pushcat','pushacct','pushreg','pushstack','backup_storages','static_deploys')`;
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

  it("único composto via pushEntities: cria o índice no servidor (reference → _id) e enforça pelo SDK", async () => {
    const stack = defineEntity("pushstack", { name: text().notNull() });
    const reg = defineEntity(
      "pushreg",
      { slugName: text().notNull(), stack: reference(stack) },
      { unique: [["slugName", "stack"]] },
    );

    // O caminho REAL do SDK: pushEntities serializa (toIR, com os grupos) → /admin/entities.
    const res = await pushEntities({ reg, stack }, opts()); // ordem invertida de propósito
    expect(res.review).toEqual([]);
    expect(res.applied).toEqual(["pushstack", "pushreg"]); // dep-order: stack primeiro

    // O índice único composto nasceu no servidor, com a reference resolvida pra `stack_id`.
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const idx = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'pushreg_slug_name_stack_id_key'`;
    expect(idx[0]!.n).toBe(1);

    // Funcional pelo SDK: mesma combinação (slug + stack) barra; stack diferente passa.
    const weave = createClient({ ...opts(), entities: { pushstack: stack, pushreg: reg } });
    const s1 = await weave.pushstack.create({ name: "s1" });
    const s2 = await weave.pushstack.create({ name: "s2" });
    await weave.pushreg.create({ slugName: "web", stackId: s1.id });
    await weave.pushreg.create({ slugName: "web", stackId: s2.id }); // mesmo slug, stack diferente: ok
    await expect(weave.pushreg.create({ slugName: "web", stackId: s1.id })).rejects.toThrow(); // repetida: barra
  });

  it("nome multi-palavra: lógico camelCase / tabela snake / accessor camelCase resolve", async () => {
    const staticDeploys = defineEntity("staticDeploys", { url: text().notNull() });
    const backupStorages = defineEntity("backupStorages", { label: text().notNull(), deploy: reference(staticDeploys) });
    const res = await pushEntities({ backupStorages, staticDeploys }, opts());
    expect(res.review).toEqual([]);

    // tabelas em snake_case (não mashadas): backup_storages / static_deploys.
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('backup_storages','static_deploys')`;
    expect(tables.map((t) => t.table_name).sort()).toEqual(["backup_storages", "static_deploys"]);

    // accessor camelCase + o servidor resolve o path camelCase (tableize) pra a tabela snake.
    const weave = createClient({ ...opts(), entities: { backupStorages, staticDeploys } });
    const d = await weave.staticDeploys.create({ url: "https://x" });
    const b = await weave.backupStorages.create({ label: "nightly", deployId: d.id });
    expect(b.label).toBe("nightly");
    expect(b.deployId).toBe(d.id);
    expect((await weave.backupStorages.findOne({ label: "nightly" }))?.id).toBe(b.id);
  });

  it("gen: arquivo/barrel/arg usam o nome lógico camelCase", async () => {
    const { files } = await genProject(opts());
    expect(Object.keys(files)).toContain("entities/backupStorages.ts");
    expect(Object.keys(files)).toContain("entities/staticDeploys.ts");
    const src = files["entities/backupStorages.ts"]!;
    expect(src).toContain('defineEntity("backupStorages"');
    expect(src).toContain("reference(staticDeploys)"); // alvo pelo nome lógico
    expect(src).toContain('from "./staticDeploys.js"'); // import pelo arquivo lógico
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
