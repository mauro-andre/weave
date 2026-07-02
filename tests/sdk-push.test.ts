import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { pushEntities, genProject, createClient, defineEntity, text, int4, reference, owned, array, mirror } from "@mauroandre/weave-sdk";

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
        await sql`DROP TABLE IF EXISTS pushprod, pushcat, pushacct, pushreg, pushstack, backup_storages, static_deploys, push_presets__items, push_presets, stk_stacks, stk_workers, mir_carts__items, mir_carts, mir_products CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('pushprod','pushcat','pushacct','pushreg','pushstack','backup_storages','static_deploys','push_presets','stk_stacks','stk_workers','mir_carts','mir_products')`;
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

  it("owned(array): push (SDK) → materializa raiz+child → cria com array aninhado → lê de volta → gen importa `array`", async () => {
    const pushPresets = defineEntity("pushPresets", {
      label: text().notNull(),
      items: owned(array({ name: text().notNull(), port: int4().notNull() })),
    });

    // 1) PUSH via SDK (nome lógico camelCase → tabela snake)
    const res = await pushEntities({ pushPresets }, opts());
    expect(res.review).toEqual([]);
    expect(res.applied).toEqual(["pushPresets"]); // reporta o nome lógico

    // 2) tabelas materializadas: raiz + child do owned
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('push_presets','push_presets__items')`;
    expect(tables.map((t) => t.table_name).sort()).toEqual(["push_presets", "push_presets__items"]);

    // 3) CRIAÇÃO via SDK, com o array aninhado (accessor camelCase resolve pra a tabela snake)
    const weave = createClient({ ...opts(), entities: { pushPresets } });
    const created = await weave.pushPresets.create({
      label: "prod",
      items: [
        { name: "web", port: 80 },
        { name: "db", port: 5432 },
      ],
    });
    expect(created.id).toBeTruthy();
    expect(created.label).toBe("prod");
    expect(created.items).toHaveLength(2); // owned aninha automaticamente no retorno

    // 4) as linhas do array chegaram no child table (na BASE), ligadas ao pai
    const childRows = await sql<{ name: string; port: number }[]>`
      SELECT name, port FROM push_presets__items ORDER BY port`;
    expect(childRows).toEqual([
      { name: "web", port: 80 },
      { name: "db", port: 5432 },
    ]);

    // 5) leitura de volta pelo SDK, com o array reconstruído
    const found = await weave.pushPresets.findOne({ label: "prod" });
    expect(found?.items.map((i) => i.port).sort((a, b) => a - b)).toEqual([80, 5432]);

    // 6) GEN: o arquivo gerado usa owned(array({…})) E importa `array` (o fix do bug)
    const { files } = await genProject(opts());
    const src = files["entities/pushPresets.ts"]!;
    expect(src).toContain("owned(array({");
    const importLine = src.split("\n").find((l) => l.startsWith("import {"))!;
    expect(importLine).toContain("array");
    expect(importLine).toContain("owned");
  });

  it("updateOne troca/limpa FK de reference que já tem valor (múltiplas refs pro mesmo alvo)", async () => {
    // duas refs pro MESMO entity (worker + migratingFrom → workers) — o caso do PodCubo.
    const workers = defineEntity("stkWorkers", { name: text().notNull() });
    const stacks = defineEntity("stkStacks", {
      name: text().notNull(),
      worker: reference(workers),
      migratingFrom: reference(workers),
    });
    await pushEntities({ stkWorkers: workers, stkStacks: stacks }, opts());
    const weave = createClient({ ...opts(), entities: { stkWorkers: workers, stkStacks: stacks } });

    const A = await weave.stkWorkers.create({ name: "A" });
    const B = await weave.stkWorkers.create({ name: "B" });

    // create com FK (uma das duas refs pro mesmo alvo)
    const s = await weave.stkStacks.create({ name: "s", workerId: A.id });
    expect(s.workerId).toBe(A.id);

    // ❌→✅ trocar um FK que JÁ tem valor: worker A → B (era no-op silencioso)
    await weave.stkStacks.updateOne({ id: s.id }, { workerId: B.id });
    expect((await weave.stkStacks.findOne({ id: s.id }))?.workerId).toBe(B.id);
    // confirma NA BASE (não só no read)
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = await db()<{ worker_id: string }[]>`SELECT worker_id FROM stk_stacks WHERE id = ${s.id}`;
    expect(rows[0]?.worker_id).toBe(B.id);

    // null → valor (setar a outra ref que estava null)
    await weave.stkStacks.updateOne({ id: s.id }, { migratingFromId: A.id });
    expect((await weave.stkStacks.findOne({ id: s.id }))?.migratingFromId).toBe(A.id);

    // valor → null (limpar FK que tinha valor)
    await weave.stkStacks.updateOne({ id: s.id }, { migratingFromId: null });
    const after = await weave.stkStacks.findOne({ id: s.id });
    expect(after?.migratingFromId).toBeNull();
    expect(after?.workerId).toBe(B.id); // a outra ref não foi afetada
  });

  it("mirror(entity): push (SDK) → materializa a base + extras no child → CRUD → gen round-trip", async () => {
    const products = defineEntity("mirProducts", { name: text().notNull(), price: int4().notNull() });
    const carts = defineEntity("mirCarts", {
      code: text().notNull(),
      // espelha `products` (name, price) + campo local `quantity`, 1:N.
      items: owned(array(mirror(products, { quantity: int4().notNull() }))),
    });

    // 1) PUSH via SDK
    const res = await pushEntities({ mirProducts: products, mirCarts: carts }, opts());
    expect(res.review).toEqual([]);

    // 2) o child materializou a forma ESPELHADA (name, price) + o extra (quantity)
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='mir_carts__items'`;
    const names = cols.map((c) => c.column_name);
    for (const c of ["name", "price", "quantity"]) expect(names).toContain(c); // base + extra

    // 3) CRIA via SDK com a forma mesclada (base + extra), tipado
    const weave = createClient({ ...opts(), entities: { mirProducts: products, mirCarts: carts } });
    const cart = await weave.mirCarts.create({
      code: "C1",
      items: [
        { name: "Widget", price: 100, quantity: 2 },
        { name: "Gadget", price: 50, quantity: 1 },
      ],
    });
    expect(cart.items).toHaveLength(2);

    // 4) as linhas foram pra o child com base + extra (na BASE)
    const rows = await sql<{ name: string; price: number; quantity: number }[]>`
      SELECT name, price, quantity FROM mir_carts__items ORDER BY price DESC`;
    expect(rows).toEqual([
      { name: "Widget", price: 100, quantity: 2 },
      { name: "Gadget", price: 50, quantity: 1 },
    ]);

    // 5) leitura de volta
    const found = await weave.mirCarts.findOne({ code: "C1" });
    expect(found?.items.map((i) => i.name).sort()).toEqual(["Gadget", "Widget"]);

    // 6) GEN: o arquivo gerado usa owned(array(mirror(...))) e importa a base
    const { files } = await genProject(opts());
    const src = files["entities/mirCarts.ts"]!;
    expect(src).toContain("owned(array(mirror(mirProducts");
    expect(src).toContain('from "./mirProducts.js"');
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
