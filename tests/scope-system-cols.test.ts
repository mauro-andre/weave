import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineScope, scopeRule, pushScopes, defineEntity, text, reference } from "@mauroandre/weave-sdk";

// Scope where sobre colunas de SISTEMA (id/createdAt/updatedAt) e FK-shorthand (<field>Id).
// O `whereFieldsToFilter` usa sentinel (`@id`) pras de sistema e o `$id` da ref (como folha)
// pro FK; o enforcement resolve de volta. Caso central do multi-tenancy: filtrar por
// company.id = { param } (o token carrega o id da empresa, não o slug).

const tenant = defineEntity("scompany", { name: text().notNull() });
const doc = defineEntity("sdoc", { title: text().notNull(), company: reference(tenant) });

describe("scope where: colunas de sistema + FK-shorthand (multi-tenancy)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let acme = "";
  let globex = "";
  const base = () => ({ url: "http://localhost", key, fetch: (r: Request) => app.hono.fetch(r) });
  const client = () => createClient({ ...base(), entities: { scompany: tenant, sdoc: doc } });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS sdoc, scompany CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('sdoc','scompany')`;
        await sql`DELETE FROM weave_scopes WHERE name IN ('tenant_fk','tenant_trav','by_id')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "scompany", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "sdoc",
          fields: {
            title: { kind: "column", type: "text", notNull: true },
            company: { kind: "reference", target: "scompany", cardinality: "one" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "sys key" } });
    key = (await res.json()).key as string;

    const god = client();
    acme = (await god.scompany.create({ name: "Acme" })).id;
    globex = (await god.scompany.create({ name: "Globex" })).id;
    await god.sdoc.create({ title: "A1", companyId: acme });
    await god.sdoc.create({ title: "A2", companyId: acme });
    await god.sdoc.create({ title: "G1", companyId: globex });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("FK-shorthand: where { companyId: { eq: { param } } } filtra pelo tenant", async () => {
    await pushScopes(
      { s: defineScope("tenant_fk", [scopeRule(doc, { verbs: ["read"], where: { companyId: { eq: { param: "co" } } } })]) },
      base(),
    );
    const rows = await client().as("tenant_fk", { co: acme }).sdoc.findMany();
    expect(rows.map((r) => r.title).sort()).toEqual(["A1", "A2"]);
  });

  it("traversal até o id de SISTEMA: where { company: { id: { eq: { param } } } }", async () => {
    await pushScopes(
      { s: defineScope("tenant_trav", [scopeRule(doc, { verbs: ["read"], where: { company: { id: { eq: { param: "co" } } } } })]) },
      base(),
    );
    const rows = await client().as("tenant_trav", { co: globex }).sdoc.findMany();
    expect(rows.map((r) => r.title)).toEqual(["G1"]);
  });

  it("coluna de sistema na RAIZ: where { id: { eq: { param } } }", async () => {
    const target = (await client().sdoc.findMany()).find((r) => r.title === "A1")! as { id: string };
    await pushScopes(
      { s: defineScope("by_id", [scopeRule(doc, { verbs: ["read"], where: { id: { eq: { param: "docId" } } } })]) },
      base(),
    );
    const rows = await client().as("by_id", { docId: target.id }).sdoc.findMany();
    expect(rows.map((r) => r.title)).toEqual(["A1"]);
  });
});
