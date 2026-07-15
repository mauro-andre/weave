import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineScope, scopeRule, pushScopes, defineEntity, text, reference } from "@mauroandre/weave-sdk";

// SCOPE × EXPAND — o scope tem que COMPOR pela referência.
//
// O `resolveAccess` roda pra entity da ROTA (a raiz). O `expand`/`select` hidratam
// referências por baixo, no query layer, que é agnóstico de scope — então a regra da
// entity EXPANDIDA (verbs/fields) não se aplicava: uma entity sem regra (403 no acesso
// direto) voltava INTEIRA por referência, e um `fields.exclude` era furado pelo expand.
// Aqui a garantia é: alcançar uma entity por referência vale o mesmo que acessá-la.

const company = defineEntity("xcompany", { name: text().notNull() });
const secret = defineEntity("xsecret", { code: text().notNull(), label: text().notNull() });
const doc = defineEntity("xdoc", {
  title: text().notNull(),
  company: reference(company),
  secret: reference(secret),
});

describe("scope × expand — a regra da entity expandida vale", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let acme = "";
  const entities = { xcompany: company, xsecret: secret, xdoc: doc };
  const base = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const god = () => createClient(base());

  // `masked`: xsecret TEM regra, mas com `code` excluído. A leitura direta poda —
  // alcançar por expand tem que podar igual.
  const masked = defineScope("xmasked", [
    scopeRule(doc, { verbs: ["read"], where: { company: { id: { eq: { param: "co" } } } } }),
    scopeRule(secret, { verbs: ["read"], fields: { exclude: ["code"] } }),
    scopeRule(company, { verbs: ["read"] }),
  ]);
  // `noRule`: xsecret NÃO tem regra nenhuma → 403 direto, e 403 por expand também.
  const noRule = defineScope("xnorule", [
    scopeRule(doc, { verbs: ["read"], where: { company: { id: { eq: { param: "co" } } } } }),
    scopeRule(company, { verbs: ["read"] }),
  ]);

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS xdoc, xsecret, xcompany CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('xdoc','xsecret','xcompany')`;
        await sql`DELETE FROM weave_scopes WHERE name IN ('xmasked','xnorule')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "xcompany", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "xsecret",
          fields: {
            code: { kind: "column", type: "text", notNull: true },
            label: { kind: "column", type: "text", notNull: true },
          },
        });
        await applyEntity({
          irVersion: 1,
          name: "xdoc",
          fields: {
            title: { kind: "column", type: "text", notNull: true },
            company: { kind: "reference", target: "xcompany", cardinality: "one" },
            secret: { kind: "reference", target: "xsecret", cardinality: "one" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "xp key" } });
    key = (await res.json()).key as string;

    acme = (await god().xcompany.create({ name: "Acme" })).id;
    const s = await god().xsecret.create({ code: "TOPSECRET", label: "visible" });
    await god().xdoc.create({ title: "A1", companyId: acme, secretId: s.id });
    await pushScopes({ masked, noRule }, base());
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("controle: leitura DIRETA da entity poda o campo excluído", async () => {
    const rows = await god().as(masked, { co: acme }).xsecret.findMany();
    expect(rows[0]).not.toHaveProperty("code");
    expect(rows[0]).toHaveProperty("label", "visible");
  });

  it("expand aplica a projeção da entity EXPANDIDA (não vaza o excluído)", async () => {
    const rows = await god()
      .as(masked, { co: acme })
      .xdoc.findMany({}, { expand: { secret: true } });
    const s = (rows[0] as Record<string, unknown>).secret as Record<string, unknown>;
    expect(s).toBeTruthy();
    expect(s).toHaveProperty("label", "visible"); // o resto da entity continua vindo
    expect(s).not.toHaveProperty("code"); // ← o furo: vazava "TOPSECRET"
  });

  it("select também aplica a projeção da entity expandida", async () => {
    const rows = await god()
      .as(masked, { co: acme })
      .xdoc.findMany({}, { select: { title: true, secret: true } });
    const s = (rows[0] as Record<string, unknown>).secret as Record<string, unknown>;
    expect(s).toBeTruthy();
    expect(s).not.toHaveProperty("code");
  });

  it("expandir entity SEM regra no scope → 403 (igual ao acesso direto)", async () => {
    const w = god().as(noRule, { co: acme });
    // controle: acesso direto já dá 403
    await expect(w.xsecret.findMany()).rejects.toMatchObject({ status: 403 });
    // e por referência tem que dar 403 também — não devolver a entity inteira
    await expect(w.xdoc.findMany({}, { expand: { secret: true } })).rejects.toMatchObject({ status: 403 });
  });

  it("findOne por id também compõe (mesmo caminho de leitura)", async () => {
    const all = await god().xdoc.findMany();
    const id = (all[0] as { id: string }).id;
    const one = await god().as(masked, { co: acme }).xdoc.findOne({ id }, { expand: { secret: true } });
    const s = (one as Record<string, unknown>).secret as Record<string, unknown>;
    expect(s).not.toHaveProperty("code");
  });

  it("dot-path na regra da RAIZ continua podando (não regrediu)", async () => {
    const rootMask = defineScope("xrootmask", [
      scopeRule(doc, {
        verbs: ["read"],
        where: { company: { id: { eq: { param: "co" } } } },
        fields: { exclude: ["secret.label"] },
      }),
      scopeRule(secret, { verbs: ["read"], fields: { exclude: ["code"] } }),
      scopeRule(company, { verbs: ["read"] }),
    ]);
    await pushScopes({ rootMask }, base());
    const rows = await god()
      .as(rootMask, { co: acme })
      .xdoc.findMany({}, { expand: { secret: true } });
    const s = (rows[0] as Record<string, unknown>).secret as Record<string, unknown>;
    expect(s).not.toHaveProperty("label"); // podado pela raiz (dot-path)
    expect(s).not.toHaveProperty("code"); // podado pela regra da própria entity
  });

  it("AUTO-expand (ninguém pediu) não vira 403 — só não expande o proibido", async () => {
    // Sem `expand` na query, o servidor auto-expande 1 nível por cortesia. Sob scope, uma
    // referência proibida aí não pode virar 403 (o cliente não pediu nada) nem vazar: ela
    // simplesmente não é expandida — fica a FK, igual seria sem o auto-expand.
    const res = await app.get("/api/xdoc", {
      headers: { "x-api-key": key, "x-weave-scope": "xnorule", "x-weave-params": JSON.stringify({ co: acme }) },
    });
    expect(res.status).toBe(200); // ← e não 403
    const doc = (await res.json()).docs[0] as Record<string, unknown>;
    expect(doc).toHaveProperty("secretId"); // a FK continua
    expect(doc).not.toHaveProperty("secret"); // mas xsecret (sem regra) não foi hidratada
    expect(doc).toHaveProperty("company"); // xcompany TEM regra de read → auto-expandida
  });

  it("god (sem scope) não é afetado", async () => {
    const rows = await god().xdoc.findMany({}, { expand: { secret: true } });
    const s = (rows[0] as Record<string, unknown>).secret as Record<string, unknown>;
    expect(s).toHaveProperty("code", "TOPSECRET");
  });
});
