import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import {
  createClient,
  createScopedClient,
  WeaveScopeError,
  defineScope,
  scopeRule,
  pushScopes,
  defineEntity,
  text,
  reference,
} from "@mauroandre/weave-sdk";

// Client ESCOPADO (Peça B): scopedWeave.runAs/runAsGod/god via AsyncLocalStorage. FORA de
// qualquer run → DENY (fail-closed). No entry principal, base compartilhada com o god.
const company = defineEntity("acompany", { name: text().notNull() });
const doc = defineEntity("adoc", { title: text().notNull(), company: reference(company) });

describe("scoped client — runAs / runAsGod / god + fail-closed", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let acme = "";
  let globex = "";
  const entities = { acompany: company, adoc: doc };
  const opts = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const tenant = defineScope("atenant", [
    scopeRule(doc, { verbs: ["read"], where: { company: { id: { eq: { param: "co" } } } } }),
  ]);
  const boss = defineScope("aboss", [scopeRule(doc, { verbs: ["read"] })]); // sem where → vê tudo
  type Principal = { role: string; co: string };

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
        await sql`DELETE FROM weave_scopes WHERE name IN ('atenant','aboss')`;
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "sc key" } });
    key = (await res.json()).key as string;

    const god = createClient(opts());
    acme = (await god.acompany.create({ name: "Acme" })).id;
    globex = (await god.acompany.create({ name: "Globex" })).id;
    await god.adoc.create({ title: "A1", companyId: acme });
    await god.adoc.create({ title: "A2", companyId: acme });
    await god.adoc.create({ title: "G1", companyId: globex });
    await pushScopes({ tenant, boss }, opts());
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("base compartilhada: createScopedClient(weave) → scopedWeave.god === weave", () => {
    const weave = createClient(opts());
    const scoped = createScopedClient(weave);
    expect(scoped.god).toBe(weave); // um god client só
  });

  it("FORA de runAs → DENY (WeaveScopeError, fail-closed) — nunca god silencioso", () => {
    const scoped = createScopedClient(opts());
    expect(() => scoped.adoc.findMany()).toThrow(WeaveScopeError);
  });

  it("runAs escopa o callback (só a company do param)", async () => {
    const scoped = createScopedClient(opts());
    const rows = await scoped.runAs(tenant, { co: acme }, () => scoped.adoc.findMany());
    expect(rows.map((r) => r.title).sort()).toEqual(["A1", "A2"]);
  });

  it("runAsGod → acesso total no callback", async () => {
    const scoped = createScopedClient(opts());
    expect(await scoped.runAsGod(() => scoped.adoc.findMany())).toHaveLength(3);
  });

  it("scopedWeave.god → acesso total em qualquer ponto (auth pré-scope / boot)", async () => {
    const scoped = createScopedClient(opts());
    expect(await scoped.god.adoc.findMany()).toHaveLength(3);
  });

  it("ALS propaga através de await (handler async, inclusive setTimeout)", async () => {
    const scoped = createScopedClient(opts());
    const rows = await scoped.runAs(tenant, { co: globex }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      return scoped.adoc.findMany();
    });
    expect(rows.map((r) => r.title)).toEqual(["G1"]);
  });

  it("aninhado: runAsGod dentro de runAs, e o escopo externo RESTAURA depois", async () => {
    const scoped = createScopedClient(opts());
    const out = await scoped.runAs(tenant, { co: acme }, async () => {
      const inScope = (await scoped.adoc.findMany()).length; // Acme (2)
      const all = (await scoped.runAsGod(() => scoped.adoc.findMany())).length; // god (3)
      const back = (await scoped.adoc.findMany()).length; // volta pro escopo Acme (2)
      return { inScope, all, back };
    });
    expect(out).toEqual({ inScope: 2, all: 3, back: 2 });
  });

  it("dispatcher: first-match deriva scope + params do principal (sem if-chain)", async () => {
    const scoped = createScopedClient(opts());
    const runInScope = scoped.dispatcher<Principal>([
      { scope: tenant, when: (p) => p.role === "member", params: (p) => ({ co: p.co }) },
      { scope: boss, when: (p) => p.role === "boss" }, // sem params
    ]);
    // member → tenant escopado pelo co (Acme = 2)
    const asMember = await runInScope({ role: "member", co: acme }, () => scoped.adoc.findMany());
    expect(asMember.map((r) => r.title).sort()).toEqual(["A1", "A2"]);
    // boss → scope sem where (vê tudo = 3)
    const asBoss = await runInScope({ role: "boss", co: "" }, () => scoped.adoc.findMany());
    expect(asBoss).toHaveLength(3);
  });

  it("dispatcher: nenhum when casa → deny (WeaveScopeError, fail-closed)", () => {
    const scoped = createScopedClient(opts());
    const runInScope = scoped.dispatcher<Principal>([{ scope: boss, when: (p) => p.role === "boss" }]);
    expect(() => runInScope({ role: "nobody", co: "" }, () => scoped.adoc.findMany())).toThrow(WeaveScopeError);
  });

  it("dispatcher: overlap resolve por ORDEM (mais específico primeiro vence)", async () => {
    const scoped = createScopedClient(opts());
    // o principal casa AMBOS os `when`; a regra mais específica (tenant, acima) vence —
    // é o padrão "department acima do admin, sem tocar na regra de baixo".
    const runInScope = scoped.dispatcher<Principal>([
      { scope: tenant, when: (p) => p.role === "member", params: () => ({ co: acme }) },
      { scope: boss, when: (p) => p.role === "member" }, // também casa, mas está ABAIXO
    ]);
    const rows = await runInScope({ role: "member", co: acme }, () => scoped.adoc.findMany());
    expect(rows).toHaveLength(2); // tenant (Acme) venceu, não o boss (veria 3)
  });
});
