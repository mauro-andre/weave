import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";

const KEY = { "x-api-key": "test-api-key" };
const col = (type: string, extra: Record<string, unknown> = {}) => ({ kind: "column", type, ...extra });

describe("API de admin (/admin)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS widget, acct, retyp, conf, tmp CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('widget','acct','retyp','conf','tmp')`;
        await sql`DELETE FROM weave_scopes WHERE name = 'adm'`;
      },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  const putEntity = (name: string, body: Record<string, unknown>) =>
    app.put(`/admin/entities/${name}`, { headers: KEY, body });

  it("401 sem API key", async () => {
    expect((await app.get("/admin/entities")).status).toBe(401);
  });

  it("cria entidade via PUT, lista, lê — e a entidade é real (data API)", async () => {
    const res = await putEntity("widget", { ir: { irVersion: 1, fields: { name: col("text"), qty: col("int4") } } });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("applied");

    const list = await (await app.get("/admin/entities", { headers: KEY })).json();
    expect(list.entities.map((e: { name: string }) => e.name)).toContain("widget");

    const one = await (await app.get("/admin/entities/widget", { headers: KEY })).json();
    expect(one.name).toBe("widget");
    expect(one.fields.name).toMatchObject({ kind: "column", type: "text" });

    // prova que a tabela existe: cria um objeto pela API de dados.
    const created = await app.post("/api/widget", { headers: KEY, body: { name: "x", qty: 1 } });
    expect(created.status).toBe(201);
  });

  it("GET entidade inexistente → 404", async () => {
    expect((await app.get("/admin/entities/nope", { headers: KEY })).status).toBe(404);
  });

  it("🟡 edição needsReview → fill → applied (tornar obrigatório com vazios)", async () => {
    expect((await putEntity("acct", { ir: { irVersion: 1, fields: { label: col("text") } } })).status).toBe(200);
    // uma linha com label nulo
    expect((await app.post("/api/acct", { headers: KEY, body: {} })).status).toBe(201);

    const review = await putEntity("acct", { ir: { irVersion: 1, fields: { label: col("text", { notNull: true }) } } });
    expect(review.status).toBe(409);
    const plan = (await review.json()).plan as { changes: { op: string; path: string; risk: string }[] };
    expect(plan.changes.find((c) => c.op === "makeRequired")).toMatchObject({ path: "label", risk: "needsValue" });

    const applied = await putEntity("acct", {
      ir: { irVersion: 1, fields: { label: col("text", { notNull: true }) } },
      fill: { label: "filled" },
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).status).toBe("applied");
  });

  it("⛔ mudança bloqueada (mudar tipo) → 409 mesmo com confirm", async () => {
    expect((await putEntity("retyp", { ir: { irVersion: 1, fields: { n: col("int4") } } })).status).toBe(200);

    const review = await putEntity("retyp", { ir: { irVersion: 1, fields: { n: col("text") } } });
    expect(review.status).toBe(409);
    const plan = (await review.json()).plan as { changes: { op: string; risk: string }[] };
    expect(plan.changes.find((c) => c.op === "retypeField")).toMatchObject({ risk: "blocked" });

    // bloqueado não confirma:
    const still = await putEntity("retyp", { ir: { irVersion: 1, fields: { n: col("text") } }, confirm: ["n"] });
    expect(still.status).toBe(409);
  });

  it("🔴 remover campo → needsReview → confirm → applied", async () => {
    expect((await putEntity("conf", { ir: { irVersion: 1, fields: { a: col("text"), b: col("text") } } })).status).toBe(200);

    const review = await putEntity("conf", { ir: { irVersion: 1, fields: { a: col("text") } } });
    expect(review.status).toBe(409);
    const plan = (await review.json()).plan as { changes: { op: string; path: string; risk: string }[] };
    expect(plan.changes.find((c) => c.op === "removeField")).toMatchObject({ path: "b", risk: "confirm" });

    const applied = await putEntity("conf", { ir: { irVersion: 1, fields: { a: col("text") } }, confirm: ["b"] });
    expect(applied.status).toBe(200);
  });

  it("DELETE remove a entidade do metastore", async () => {
    expect((await putEntity("tmp", { ir: { irVersion: 1, fields: { x: col("text") } } })).status).toBe(200);
    expect((await app.delete("/admin/entities/tmp", { headers: KEY })).status).toBe(200);
    expect((await app.get("/admin/entities/tmp", { headers: KEY })).status).toBe(404);
    const list = await (await app.get("/admin/entities", { headers: KEY })).json();
    expect(list.entities.map((e: { name: string }) => e.name)).not.toContain("tmp");
  });

  it("CRUD de scope via admin (PUT/GET/DELETE) e enforcement aplica", async () => {
    const put = await app.put("/admin/scopes/adm", {
      headers: KEY,
      body: { entities: { widget: { verbs: ["read"], rows: null, fields: null } } },
    });
    expect((await put.json()).ok).toBe(true);

    const list = await (await app.get("/admin/scopes", { headers: KEY })).json();
    expect(list.scopes.map((s: { name: string }) => s.name)).toContain("adm");
    const one = await (await app.get("/admin/scopes/adm", { headers: KEY })).json();
    expect(one.entities.widget.verbs).toEqual(["read"]);

    // o scope criado por API já vale na API de dados: read ok, create negado.
    const scopeHeaders = { ...KEY, "x-weave-scope": "adm" };
    expect((await app.get("/api/widget", { headers: scopeHeaders })).status).toBe(200);
    expect((await app.post("/api/widget", { headers: scopeHeaders, body: { name: "y" } })).status).toBe(403);

    expect((await app.delete("/admin/scopes/adm", { headers: KEY })).status).toBe(200);
    expect((await app.get("/admin/scopes/adm", { headers: KEY })).status).toBe(404);
  });
});
