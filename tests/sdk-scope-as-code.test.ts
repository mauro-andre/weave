import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineScope, pushScopes, defineEntity, text, int4 } from "@mauroandre/weave-sdk";

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
        await sql`DELETE FROM weave_scopes WHERE name = 'sdkstore2'`;
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
    // O dev escreve o scope por NOME, Prisma-style; pushScopes resolve os ids.
    const storefront = defineScope("sdkstore2", {
      sdkpur2: {
        verbs: ["read"],
        where: { company: { eq: { param: "company" } } },
        fields: { exclude: ["cost"] },
      },
    });
    const out = await pushScopes({ storefront }, base());
    expect(out.pushed).toEqual(["sdkstore2"]);

    const store = createClient({ ...base(), schema: { sdkpur2: purchase } }).as("sdkstore2", { company: 1 });
    const rows = await store.sdkpur2.find();
    expect(rows.length).toBe(3); // só company 1 (filtro de linhas resolvido por id)
    expect(rows.every((r) => !("cost" in (r as Record<string, unknown>)))).toBe(true); // cost podado

    // verbo create não está no scope → 403
    await expect(store.sdkpur2.create({ code: "X", cost: 1, company: 1 })).rejects.toMatchObject({ status: 403 });
  });
});
