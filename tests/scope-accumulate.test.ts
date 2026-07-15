import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import {
  createClient,
  defineScope,
  scopeRule,
  pushScopes,
  defineEntity,
  text,
  int4,
  inc,
  setOnInsert,
  reference,
} from "@mauroandre/weave-sdk";

// WITH CHECK no ACCUMULATE. O `accumulate` é uma ESCRITA (upsert mergeável na key), e
// escrita sob scope tem que cair no filtro de linhas — a mesma garantia que o create/update
// já dão (ver scope-with-check.test.ts). O gap: o handler checava só o VERBO e descartava
// o resto do acesso, então dava pra mergear na linha de OUTRO tenant (write cross-tenant)
// e ainda receber a linha dele de volta sem poda (read cross-tenant).

const company = defineEntity("ycompany", { name: text().notNull() });
const stat = defineEntity("ystat", {
  bucket: text().notNull().unique(),
  company: reference(company),
  hits: int4(),
});

describe("scope WITH CHECK — accumulate cross-tenant negado", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let acme = "";
  let globex = "";
  const entities = { ycompany: company, ystat: stat };
  const base = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const god = () => createClient(base());
  // tenant: só as linhas da sua company.
  const tenant = defineScope("ytenant", [
    scopeRule(stat, { verbs: ["create", "read"], where: { company: { id: { eq: { param: "co" } } } } }),
  ]);
  const asAcme = () => god().as(tenant, { co: acme });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS ystat, ycompany CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('ystat','ycompany')`;
        await sql`DELETE FROM weave_scopes WHERE name = 'ytenant'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "ycompany", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "ystat",
          fields: {
            bucket: { kind: "column", type: "text", notNull: true, unique: true },
            company: { kind: "reference", target: "ycompany", cardinality: "one" },
            hits: { kind: "column", type: "int4" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "yacc key" } });
    key = (await res.json()).key as string;

    acme = (await god().ycompany.create({ name: "Acme" })).id;
    globex = (await god().ycompany.create({ name: "Globex" })).id;
    await god().ystat.create({ bucket: "globex-d1", companyId: globex, hits: 5 });
    await pushScopes({ tenant }, base());
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("accumulate DENTRO do tenant → ok (insert e merge)", async () => {
    const created = await asAcme().ystat.accumulate({ bucket: "acme-d1" }, { hits: inc(3), company: setOnInsert(acme) });
    expect(created.hits).toBe(3);
    const merged = await asAcme().ystat.accumulate({ bucket: "acme-d1" }, { hits: inc(4), company: setOnInsert(acme) });
    expect(merged.hits).toBe(7); // acumulou no Postgres
  });

  it("accumulate MERGEANDO na linha de outro tenant → 403, e o valor não muda", async () => {
    await expect(asAcme().ystat.accumulate({ bucket: "globex-d1" }, { hits: inc(100) })).rejects.toMatchObject({
      status: 403,
    });
    const row = (await god().ystat.findOne({ bucket: "globex-d1" })) as { hits: number };
    expect(row.hits).toBe(5); // intacto — o merge rolou pra trás
  });

  it("accumulate criando linha FORA do filtro (sem company) → 403, e nada persiste", async () => {
    await expect(asAcme().ystat.accumulate({ bucket: "orphan" }, { hits: inc(1) })).rejects.toMatchObject({
      status: 403,
    });
    expect(await god().ystat.findOne({ bucket: "orphan" })).toBeNull();
  });

  it("accumulate criando linha de OUTRO tenant → 403", async () => {
    await expect(
      asAcme().ystat.accumulate({ bucket: "novo" }, { hits: inc(1), company: setOnInsert(globex) }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await god().ystat.findOne({ bucket: "novo" })).toBeNull();
  });

  it("god (sem scope) acumula em qualquer linha", async () => {
    const r = await god().ystat.accumulate({ bucket: "globex-d1" }, { hits: inc(10) });
    expect(r.hits).toBe(15);
  });
});
