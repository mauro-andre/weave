import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, owned, array } from "@mauroandre/weave-sdk";

// `select` — leitura enxuta (whitelist). Phase 6 já existia no engine; agora ligada no
// SDK/API. Prova: sem `select` o owned vem cheio (default preservado); com `select` só o
// nomeado hidrata (owned não-selecionado NEM entra no JOIN). É a válvula pra lista de
// entity profunda (o caso do Perfil MCP: pathsApplied com ~26 tabelas owned).

const selbox = defineEntity("selbox", {
  title: text().notNull(),
  status: text(),
  items: owned(array({ sku: text().notNull() })), // owned A
  notes: owned(array({ body: text().notNull() })), // owned B
});

describe("SDK select — leitura enxuta (whitelist de owned/colunas)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities: { selbox }, fetch: (req) => app.hono.fetch(req) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS selbox__items, selbox__notes, selbox CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'selbox'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "selbox",
          fields: {
            title: { kind: "column", type: "text", notNull: true },
            status: { kind: "column", type: "text" },
            items: { kind: "owned", array: true, shape: { sku: { kind: "column", type: "text", notNull: true } } },
            notes: { kind: "owned", array: true, shape: { body: { kind: "column", type: "text", notNull: true } } },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "sel key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("SEM select: owned vem 100% hidratado (default preservado)", async () => {
    const w = weave();
    const b = await w.selbox.create({ title: "T", status: "open", items: [{ sku: "a" }], notes: [{ body: "n" }] });
    const full = await w.selbox.findOne({ id: b.id });
    expect(full!.title).toBe("T");
    expect(full!.status).toBe("open");
    expect((full!.items as { sku: string }[])[0]!.sku).toBe("a");
    expect((full!.notes as { body: string }[])[0]!.body).toBe("n"); // owned B veio
  });

  it("COM select: só o nomeado hidrata; owned/coluna não-selecionados somem", async () => {
    const w = weave();
    const b = await w.selbox.create({ title: "T2", status: "open", items: [{ sku: "x" }], notes: [{ body: "m" }] });
    const lean = await w.selbox.findOne({ id: b.id }, { select: { title: true, items: true } });
    const doc = lean as Record<string, unknown>;
    expect(doc.title).toBe("T2"); // selecionado
    expect((doc.items as { sku: string }[])[0]!.sku).toBe("x"); // owned A selecionado
    expect(doc.status).toBeUndefined(); // coluna NÃO selecionada → não vem
    expect(doc.notes).toBeUndefined(); // owned B NÃO selecionado → nem entrou no JOIN
    expect(typeof doc.id).toBe("string"); // id SEMPRE presente
    expect(doc.createdAt).toBeUndefined(); // timestamp opt-in: só vem se selecionado
  });

  it("timestamps entram no select se pedidos (e o revive os vira Date)", async () => {
    const w = weave();
    const b = await w.selbox.create({ title: "T4", items: [], notes: [] });
    const lean = await w.selbox.findOne({ id: b.id }, { select: { title: true, createdAt: true } });
    const doc = lean as Record<string, unknown>;
    expect(doc.title).toBe("T4");
    expect(doc.createdAt).toBeInstanceOf(Date); // selecionado → vem e é revivido
    expect(doc.updatedAt).toBeUndefined(); // não selecionado → não vem
  });

  it("select parcial de subárvore owned (só um campo do item)", async () => {
    const w = weave();
    const b = await w.selbox.create({ title: "T3", items: [{ sku: "y" }], notes: [] });
    const lean = await w.selbox.findMany({ id: b.id }, { select: { items: { sku: true } } });
    const doc = lean[0] as Record<string, unknown>;
    expect((doc.items as { sku: string }[])[0]!.sku).toBe("y");
    expect(doc.title).toBeUndefined(); // não selecionado
    expect(doc.notes).toBeUndefined();
  });
});
