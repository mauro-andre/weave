import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineScope, scopeRule, pushScopes, defineEntity, text, int4 } from "@mauroandre/weave-sdk";

// F4b: defineScope (por NOME) → pushScopes (converte pra by-id, grava) → weave.as
// (enforcement). Prova o round-trip completo do scope-as-code.
const purchase = defineEntity("sdkpur2", { code: text(), cost: int4(), company: int4() });

describe("SDK scope-as-code (F4b) — defineScope + pushScopes", () => {
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
        await sql`DROP TABLE IF EXISTS sdkpur2 CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'sdkpur2'`;
        await sql`DELETE FROM weave_scopes WHERE name IN ('sdkstore2', 'sdkmulti', 'sdkbare', 'sdkbarep')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "sdkpur2",
          fields: {
            code: { kind: "column", type: "text" },
            cost: { kind: "column", type: "int4" },
            company: { kind: "column", type: "int4" },
          },
        });
        const { saveObject } = await import("../app/engine/control-plane/data.js");
        for (const [code, company] of [["P1", 1], ["P2", 1], ["P3", 1], ["P4", 2], ["P5", 2]] as const) {
          await saveObject("sdkpur2", { code, cost: 60, company });
        }
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "soc key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("defineScope por nome → pushScopes (by-id) → weave.as impõe linhas + projeção + verbo", async () => {
    // O dev amarra cada regra à ENTITY por referência (scopeRule); pushScopes resolve os ids.
    const storefront = defineScope("sdkstore2", [
      scopeRule(purchase, {
        verbs: ["read"],
        where: { company: { eq: { param: "company" } } },
        fields: { exclude: ["cost"] },
      }),
    ]);
    const out = await pushScopes({ storefront }, base());
    expect(out.pushed).toEqual(["sdkstore2"]);

    // `.as` aceita o OBJETO do scope (não só a string do nome).
    const store = createClient({ ...base(), entities: { sdkpur2: purchase } }).as(storefront, { company: 1 });
    const rows = await store.sdkpur2.findMany();
    expect(rows.length).toBe(3); // só company 1 (filtro de linhas resolvido por id)
    expect(rows.every((r) => !("cost" in (r as Record<string, unknown>)))).toBe(true); // cost podado

    // verbo create não está no scope → 403
    await expect(store.sdkpur2.create({ code: "X", cost: 1, company: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it("multi-chave no where = AND implícito — não dropa condição (furo de auth fechado)", async () => {
    // dados isolados (company 9): cost 10, 60, 200
    const god = createClient({ ...base(), entities: { sdkpur2: purchase } });
    await god.sdkpur2.create({ code: "L9", cost: 10, company: 9 });
    await god.sdkpur2.create({ code: "M9", cost: 60, company: 9 });
    await god.sdkpur2.create({ code: "H9", cost: 200, company: 9 });

    // duas condições no MESMO nível: company == param AND cost < 100
    const s = defineScope("sdkmulti", [
      scopeRule(purchase, { verbs: ["read"], where: { company: { eq: { param: "co" } }, cost: { lt: 100 } } }),
    ]);
    await pushScopes({ s }, base());

    const scoped = createClient({ ...base(), entities: { sdkpur2: purchase } }).as(s, { co: 9 });
    const codes = ((await scoped.sdkpur2.findMany()) as { code: string }[]).map((r) => r.code).sort();
    // AND aplicado: L9(10) + M9(60); H9(200) fica de fora. Antes do fix o `cost` era
    // dropado em silêncio e H9 vazava (3 linhas).
    expect(codes).toEqual(["L9", "M9"]);
  });

  it("bare value no where (1:1 com a query): { company: 8 } ≡ { eq: 8 }, e { param } bare", async () => {
    const god = createClient({ ...base(), entities: { sdkpur2: purchase } });
    await god.sdkpur2.create({ code: "B8", cost: 60, company: 8 });
    await god.sdkpur2.create({ code: "C8", cost: 60, company: 8 });

    // bare literal → eq
    await pushScopes(
      { s: defineScope("sdkbare", [scopeRule(purchase, { verbs: ["read"], where: { company: 8 } })]) },
      base(),
    );
    const lit = createClient({ ...base(), entities: { sdkpur2: purchase } }).as("sdkbare");
    expect((await lit.sdkpur2.findMany()).length).toBe(2);

    // bare { param } (sem eq) → eq { param } — antes estourava no decodeOp
    await pushScopes(
      { s: defineScope("sdkbarep", [scopeRule(purchase, { verbs: ["read"], where: { company: { param: "co" } } })]) },
      base(),
    );
    const par = createClient({ ...base(), entities: { sdkpur2: purchase } }).as("sdkbarep", { co: 8 });
    expect((await par.sdkpur2.findMany()).length).toBe(2);
  });
});
