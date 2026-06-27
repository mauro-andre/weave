import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, int4 } from "@mauroandre/weave-sdk";

// F4a: weave.as(scope, params) → toda requisição leva x-weave-scope + x-weave-params.
// Modela o scopes.test: scope guardado por field-id, e o SDK escopado consome o
// enforcement (filtro de linhas + projeção + verbos).
const purchase = defineEntity("sdkpur", { code: text(), cost: int4(), company: int4() });

describe("SDK weave.as — acesso escopado (F4a)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const base = () => ({ url: "http://localhost", key, fetch: (r: Request) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS sdkpur CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'sdkpur'`;
        await sql`DELETE FROM weave_scopes WHERE name = 'sdkstore'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "sdkpur",
          fields: {
            code: { kind: "column", type: "text" },
            cost: { kind: "column", type: "int4" },
            company: { kind: "column", type: "int4" },
          },
        });
        const { saveObject } = await import("../app/engine/control-plane/data.js");
        for (const [code, company] of [["P1", 1], ["P2", 1], ["P3", 1], ["P4", 2], ["P5", 2]] as const) {
          await saveObject("sdkpur", { code, cost: 60, company });
        }
        const { getEntity } = await import("../app/engine/control-plane/entities.js");
        const ir = (await getEntity("sdkpur"))!;
        const companyId = ir.fields["company"]!.id!;
        const costId = ir.fields["cost"]!.id!;
        // scope "storefront": lê só a própria company (param), esconde `cost`.
        const { saveScope } = await import("../app/engine/control-plane/scopes.js");
        await saveScope({
          name: "sdkstore",
          entities: {
            sdkpur: {
              verbs: ["read"],
              rows: { path: [companyId], op: "equals", value: { param: "company" } },
              fields: { mode: "exclude", paths: [[costId]] },
            },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "scope key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("god (sem scope) vê tudo; escopado vê só as linhas permitidas + projeção", async () => {
    const god = createClient({ ...base(), schema: { sdkpur: purchase } });
    expect((await god.sdkpur.find()).length).toBe(5);

    const store = god.as("sdkstore", { company: 1 });
    const rows = await store.sdkpur.find();
    expect(rows.length).toBe(3); // só company 1
    expect(rows.every((r) => r.code !== undefined)).toBe(true);
    expect(rows.every((r) => !("cost" in (r as Record<string, unknown>)))).toBe(true); // cost podado
  });

  it("verbo não permitido (create num scope read-only) → WeaveScopeError 403", async () => {
    const store = createClient({ ...base(), schema: { sdkpur: purchase } }).as("sdkstore", { company: 1 });
    await expect(store.sdkpur.create({ code: "X", cost: 1, company: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it("param faltando → erro do scope (não vaza dado)", async () => {
    const store = createClient({ ...base(), schema: { sdkpur: purchase } }).as("sdkstore", {});
    await expect(store.sdkpur.find()).rejects.toMatchObject({ status: 400 });
  });
});
