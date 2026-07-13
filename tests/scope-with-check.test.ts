import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineScope, scopeRule, pushScopes, defineEntity, text, reference } from "@mauroandre/weave-sdk";

// WITH CHECK (o "USING vs WITH CHECK" do RLS): o filtro de linhas do scope filtra QUAIS
// linhas você vê/atinge (read/update target), mas o create/update também precisa garantir
// que a linha RESULTANTE cai no filtro — senão é write cross-tenant (o gap: verbo ok, linha
// não-checada). Multi-hop do caso público: wresp → dispatch → company → slug.

const company = defineEntity("wcompany", { name: text().notNull(), slug: text().notNull() });
const dispatch = defineEntity("wdispatch", { label: text().notNull(), company: reference(company) });
const wresp = defineEntity("wresp", { answer: text().notNull(), dispatch: reference(dispatch) });

describe("scope WITH CHECK — write cross-tenant negado (create + update)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let dA = ""; // dispatch da Acme
  let dG = ""; // dispatch da Globex
  const base = () => ({ url: "http://localhost", key, fetch: (r: Request) => app.hono.fetch(r) });
  const god = () => createClient({ ...base(), entities: { wcompany: company, wdispatch: dispatch, wresp } });
  // scope público: só respostas cujo dispatch pertence à company do slug (param).
  const pub = defineScope("wpub", [
    scopeRule(wresp, {
      verbs: ["read", "create", "update"],
      where: { dispatch: { company: { slug: { eq: { param: "slug" } } } } },
    }),
  ]);
  const acme = () => god().as(pub, { slug: "acme" });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS wresp, wdispatch, wcompany CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('wresp','wdispatch','wcompany')`;
        await sql`DELETE FROM weave_scopes WHERE name = 'wpub'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "wcompany",
          fields: { name: { kind: "column", type: "text", notNull: true }, slug: { kind: "column", type: "text", notNull: true } },
        });
        await applyEntity({
          irVersion: 1,
          name: "wdispatch",
          fields: {
            label: { kind: "column", type: "text", notNull: true },
            company: { kind: "reference", target: "wcompany", cardinality: "one" },
          },
        });
        await applyEntity({
          irVersion: 1,
          name: "wresp",
          fields: {
            answer: { kind: "column", type: "text", notNull: true },
            dispatch: { kind: "reference", target: "wdispatch", cardinality: "one" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "wc key" } });
    key = (await res.json()).key as string;

    const acmeCo = await god().wcompany.create({ name: "Acme", slug: "acme" });
    const globexCo = await god().wcompany.create({ name: "Globex", slug: "globex" });
    dA = (await god().wdispatch.create({ label: "A", companyId: acmeCo.id })).id;
    dG = (await god().wdispatch.create({ label: "G", companyId: globexCo.id })).id;
    await pushScopes({ pub }, base());
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("create DENTRO do tenant → ok", async () => {
    const r = await acme().wresp.create({ answer: "in", dispatchId: dA });
    expect(r.answer).toBe("in");
  });

  it("create CROSS-tenant → 403, e nada persiste (rollback)", async () => {
    await expect(acme().wresp.create({ answer: "leak", dispatchId: dG })).rejects.toMatchObject({ status: 403 });
    // o dispatch da Globex não recebeu nenhuma resposta (a linha rolou pra trás)
    const all = await god().wresp.findMany({ dispatchId: dG });
    expect(all).toHaveLength(0);
  });

  it("update DENTRO do tenant → ok", async () => {
    const r = await acme().wresp.create({ answer: "v1", dispatchId: dA });
    const updated = await acme().wresp.updateOne({ id: r.id }, { answer: "v2" });
    expect((updated as { answer: string }).answer).toBe("v2");
  });

  it("update MOVENDO pra outro tenant (patch no FK) → 403, linha não migra", async () => {
    const r = await acme().wresp.create({ answer: "stay", dispatchId: dA });
    await expect(acme().wresp.updateOne({ id: r.id }, { dispatchId: dG })).rejects.toMatchObject({ status: 403 });
    const still = (await god().wresp.findOne({ id: r.id })) as { dispatchId: string };
    expect(still.dispatchId).toBe(dA); // continua na Acme, o move rolou pra trás
  });

  it("bulk createMany com UMA linha cross-tenant → 403 atômico (nem a válida persiste)", async () => {
    const before = (await god().wresp.findMany({ dispatchId: dA })).length;
    await expect(
      acme().wresp.createMany([
        { answer: "ok", dispatchId: dA },
        { answer: "bad", dispatchId: dG },
      ]),
    ).rejects.toMatchObject({ status: 403 });
    const after = (await god().wresp.findMany({ dispatchId: dA })).length;
    expect(after).toBe(before); // o lote inteiro rolou pra trás
  });
});
