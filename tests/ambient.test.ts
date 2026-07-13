import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineScope, scopeRule, pushScopes, defineEntity, text, reference } from "@mauroandre/weave-sdk";
import { createAmbientClient, WeaveScopeError } from "@mauroandre/weave-sdk/als";

// Client AMBIENT (Peça B): runAs/runAsGod/weave.god via AsyncLocalStorage. FORA de qualquer
// run → DENY (fail-closed). Prova o comportamento end-to-end contra o server real.
const company = defineEntity("acompany", { name: text().notNull() });
const doc = defineEntity("adoc", { title: text().notNull(), company: reference(company) });

describe("ambient client — runAs / runAsGod / god + fail-closed", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let acme = "";
  let globex = "";
  const entities = { acompany: company, adoc: doc };
  const opts = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const tenant = defineScope("atenant", [
    scopeRule(doc, { verbs: ["read"], where: { company: { id: { eq: { param: "co" } } } } }),
  ]);

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS adoc, acompany CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('adoc','acompany')`;
        await sql`DELETE FROM weave_scopes WHERE name = 'atenant'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "acompany", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "adoc",
          fields: {
            title: { kind: "column", type: "text", notNull: true },
            company: { kind: "reference", target: "acompany", cardinality: "one" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "amb key" } });
    key = (await res.json()).key as string;

    const god = createClient(opts());
    acme = (await god.acompany.create({ name: "Acme" })).id;
    globex = (await god.acompany.create({ name: "Globex" })).id;
    await god.adoc.create({ title: "A1", companyId: acme });
    await god.adoc.create({ title: "A2", companyId: acme });
    await god.adoc.create({ title: "G1", companyId: globex });
    await pushScopes({ tenant }, opts());
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("FORA de runAs → DENY (WeaveScopeError, fail-closed) — nunca god silencioso", () => {
    const weave = createAmbientClient(opts());
    expect(() => weave.adoc.findMany()).toThrow(WeaveScopeError);
  });

  it("runAs escopa o callback (só a company do param)", async () => {
    const weave = createAmbientClient(opts());
    const rows = await weave.runAs(tenant, { co: acme }, () => weave.adoc.findMany());
    expect(rows.map((r) => r.title).sort()).toEqual(["A1", "A2"]);
  });

  it("runAsGod → acesso total no callback", async () => {
    const weave = createAmbientClient(opts());
    const rows = await weave.runAsGod(() => weave.adoc.findMany());
    expect(rows).toHaveLength(3);
  });

  it("weave.god → acesso total em qualquer ponto (auth pré-scope / boot)", async () => {
    const weave = createAmbientClient(opts());
    expect(await weave.god.adoc.findMany()).toHaveLength(3);
  });

  it("ALS propaga através de await (handler async, inclusive setTimeout)", async () => {
    const weave = createAmbientClient(opts());
    const rows = await weave.runAs(tenant, { co: globex }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      return weave.adoc.findMany();
    });
    expect(rows.map((r) => r.title)).toEqual(["G1"]);
  });

  it("aninhado: runAsGod dentro de runAs, e o escopo externo RESTAURA depois", async () => {
    const weave = createAmbientClient(opts());
    const out = await weave.runAs(tenant, { co: acme }, async () => {
      const scoped = (await weave.adoc.findMany()).length; // Acme (2)
      const all = (await weave.runAsGod(() => weave.adoc.findMany())).length; // god (3)
      const back = (await weave.adoc.findMany()).length; // volta pro escopo Acme (2)
      return { scoped, all, back };
    });
    expect(out).toEqual({ scoped: 2, all: 3, back: 2 });
  });
});
