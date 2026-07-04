import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";

// POST /admin/push (aplica um conjunto via applyProject + persiste o pending) e
// GET /admin/pending (a GUI lê). É a superfície HTTP que o pushAll e a GUI usam.
const KEY = { "x-api-key": "test-api-key" };

describe("API de admin — /admin/push + /admin/pending", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS aped, apnew CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('aped','apnew')`;
        await sql`DELETE FROM weave_pending`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "aped",
          fields: { name: { kind: "column", type: "text", notNull: true }, old: { kind: "column", type: "text" } },
        });
        await sql`INSERT INTO aped (name, old) VALUES ('a', 'b')`; // dado → drop de old é destrutivo
      },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  // desejado: apnew nova (auto) + aped removendo `old` (confirm, segura)
  const desired = [
    { irVersion: 1, name: "apnew", fields: { title: { kind: "column", type: "text", notNull: true } } },
    { irVersion: 1, name: "aped", fields: { name: { kind: "column", type: "text", notNull: true } } },
  ];

  it("401 sem API key", async () => {
    expect((await app.post("/admin/push", { body: { entities: [] } })).status).toBe(401);
  });

  it("push segura o destrutivo, aplica o resto, e persiste o pending", async () => {
    const res = await app.post("/admin/push", { headers: KEY, body: { entities: desired, source: "cli" } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.applied).toEqual(["apnew"]);
    expect(out.review).toHaveLength(1);
    expect(out.review[0].name).toBe("aped");

    // GET /admin/pending → a GUI vê o pending
    const p = await (await app.get("/admin/pending", { headers: KEY })).json();
    expect(p.pending).not.toBeNull();
    expect(p.pending.source).toBe("cli");
    expect(p.pending.entries).toHaveLength(1);
    expect(p.pending.entries[0].name).toBe("aped");
    expect(p.pending.entries[0].ir).toMatchObject({ name: "aped" }); // o desejado, pra resolver
  });

  it("resolver com confirm aplica e limpa o pending", async () => {
    const res = await app.post("/admin/push", {
      headers: KEY,
      body: { entities: desired, confirm: { aped: ["old"] } },
    });
    const out = await res.json();
    expect(out.review).toEqual([]);
    expect(out.applied).toContain("aped");

    const p = await (await app.get("/admin/pending", { headers: KEY })).json();
    expect(p.pending).toBeNull();
  });
});
