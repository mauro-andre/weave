import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey, action_deleteKey } from "../app/pages/Api.js";

describe("API REST + API keys", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let master: { id: string };
  let key = ""; // chave criada pela action, usada nos testes da API
  const KEY = () => ({ "x-api-key": key });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS widget CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'widget'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "widget",
          fields: { name: { kind: "column", type: "text" }, qty: { kind: "column", type: "int4" } },
        });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;

    // Cria uma API key pela MESMA action da GUI e usa nos testes.
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "test key" } });
    key = (await res.json()).key as string;
    expect(key.startsWith("weave_sk_")).toBe(true);
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("a key criada pela action autentica a API", async () => {
    const res = await app.get("/api/widget", { headers: KEY() });
    expect(res.status).toBe(200);
  });

  it("401 sem key ou com key inválida", async () => {
    expect((await app.get("/api/widget")).status).toBe(401);
    expect((await app.get("/api/widget", { headers: { "x-api-key": "weave_sk_nope" } })).status).toBe(401);
  });

  it("CRUD completo via REST", async () => {
    let res = await app.get("/api/widget", { headers: KEY() });
    expect((await res.json()).docsQuantity).toBe(0);

    res = await app.post("/api/widget", { headers: KEY(), body: { name: "Alpha", qty: 5 } });
    expect(res.status).toBe(201);
    const id = (await res.json()).id as string;

    res = await app.get(`/api/widget/${id}`, { headers: KEY() });
    expect((await res.json()).qty).toBe(5);

    // PATCH por where (updateOne) = merge: qty muda, name preservado.
    res = await app.patch("/api/widget", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { qty: 9 } });
    const patched = await res.json();
    expect(patched.qty).toBe(9);
    expect(patched.name).toBe("Alpha");

    // DELETE por where (deleteOne) devolve o objeto deletado.
    res = await app.delete("/api/widget", { headers: KEY(), query: { where: JSON.stringify({ id }) } });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(id);
    expect((await app.get(`/api/widget/${id}`, { headers: KEY() })).status).toBe(404);
  });

  it("filtro via query string", async () => {
    await app.post("/api/widget", { headers: KEY(), body: { name: "Beta", qty: 1 } });
    await app.post("/api/widget", { headers: KEY(), body: { name: "Gamma", qty: 2 } });
    const where = JSON.stringify({ name: { ilike: "%amm%" } });
    const res = await app.get("/api/widget", { headers: KEY(), query: { where } });
    expect((await res.json()).docs.map((d: { name: string }) => d.name)).toEqual(["Gamma"]);
  });

  it("404 entidade desconhecida", async () => {
    expect((await app.get("/api/nope", { headers: KEY() })).status).toBe(404);
  });

  it("revogar a key invalida o acesso (key → 200 → revoga → 401)", async () => {
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "temp" } });
    const created = (await res.json()) as { id: string; key: string };
    expect((await app.get("/api/widget", { headers: { "x-api-key": created.key } })).status).toBe(200);

    await app.as({ user: master }).action(action_deleteKey, { body: { id: created.id } });
    expect((await app.get("/api/widget", { headers: { "x-api-key": created.key } })).status).toBe(401);
  });
});
