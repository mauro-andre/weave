import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";

// Identificadores citados: um campo chamado `join` (palavra reservada SQL) deve
// funcionar de ponta a ponta — DDL, INSERT, SELECT, where, orderBy, aggregate,
// UPDATE e DELETE — porque toda a SQL emitida cita identificadores ("join").
describe("identificadores reservados — campo `join`", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const KEY = () => ({ "x-api-key": key });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS reprojoin CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'reprojoin'`;
        await sql`DELETE FROM weave_api_keys`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "join key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("push, CRUD, filtro, ordenação e agregação sobre o campo `join`", async () => {
    // 1. Push: a DDL cita identificadores → não há syntax error.
    const { applyEntity } = await import("../app/engine/control-plane/entities.js");
    const out = await applyEntity({
      irVersion: 1,
      name: "reprojoin",
      fields: {
        nome: { kind: "column", type: "text" },
        join: { kind: "column", type: "text", index: true },
        n: { kind: "column", type: "int4" },
      },
    });
    expect(out.status).toBe("applied");

    // 2. Create (INSERT citado).
    let res = await app.post("/api/reprojoin", { headers: KEY(), body: { nome: "a", join: "inner", n: 1 } });
    expect(res.status).toBe(201);
    const id = (await res.json()).id as string;
    await app.post("/api/reprojoin", { headers: KEY(), body: { nome: "b", join: "left", n: 2 } });

    // 3. Read (SELECT + json_build_object citados).
    res = await app.get(`/api/reprojoin/${id}`, { headers: KEY() });
    expect(res.status).toBe(200);
    expect((await res.json()).join).toBe("inner");

    // 4. Filtro (compileWhere): bare eq, operador e lógico.
    res = await app.get("/api/reprojoin", { headers: KEY(), query: { where: JSON.stringify({ join: "inner" }) } });
    expect((await res.json()).docsQuantity).toBe(1);
    res = await app.get("/api/reprojoin", {
      headers: KEY(),
      query: { where: JSON.stringify({ join: { ilike: "lef%" }, n: { gte: 1 } }) },
    });
    expect((await res.json()).docsQuantity).toBe(1);

    // 5. Ordenação pela coluna reservada.
    res = await app.get("/api/reprojoin", { headers: KEY(), query: { orderBy: JSON.stringify({ join: "asc" }) } });
    expect((await res.json()).docs.map((d: { join: string }) => d.join)).toEqual(["inner", "left"]);

    // 6. Agregação com groupBy na coluna reservada.
    res = await app.post("/api/reprojoin/aggregate", {
      headers: KEY(),
      body: { groupBy: ["join"], select: { total: { agg: "count" } }, orderBy: { join: "asc" } },
    });
    expect(res.status).toBe(200);
    const agg = await res.json();
    expect(agg.rows.map((r: { join: string }) => r.join)).toEqual(["inner", "left"]);

    // 7. Update (merge) e delete citados.
    res = await app.patch("/api/reprojoin", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { join: "cross" } });
    expect((await res.json()).join).toBe("cross");
    res = await app.delete("/api/reprojoin", { headers: KEY(), query: { where: JSON.stringify({ join: "cross" }) } });
    expect(res.status).toBe(200);
    res = await app.get("/api/reprojoin", { headers: KEY() });
    expect((await res.json()).docsQuantity).toBe(1);
  });
});
