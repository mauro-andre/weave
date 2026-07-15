import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, int4, inc, reference } from "@mauroandre/weave-sdk";

// `accumulate` com REFERENCE na chave única — o rollup por tenant.
//
// Dois vocabulários que não se falavam: a key é `Partial<InferInsert>`, onde uma reference
// N:1 só existe como FK-shorthand (`companyId`); já o `unique` da entity e o DDL falam o
// nome do CAMPO (`company` → coluna `company_id`). Sem normalizar, NENHUMA combinação
// funciona: `unique: [["day","company"]]` recusa a key que o tipo exige, e
// `unique: [["day","companyId"]]` o DDL recusa. "contador por dia por empresa" — o caso
// mais natural de métrica multi-tenant — era inalcançável.

const company = defineEntity("kco", { name: text().notNull() });
const stat = defineEntity(
  "kstat",
  { day: text().notNull(), company: reference(company), hits: int4() },
  { unique: [["day", "company"]] },
);

describe("accumulate — reference na chave única", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let acme = "";
  let globex = "";
  const entities = { kco: company, kstat: stat };
  const base = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const god = () => createClient(base());

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS kstat, kco CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('kstat','kco')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "kco", fields: { name: { kind: "column", type: "text", notNull: true } } });
        // O unique fala o nome do CAMPO (`company`) — é o que o DDL aceita.
        await applyEntity({
          irVersion: 1,
          name: "kstat",
          unique: [["day", "company"]],
          fields: {
            day: { kind: "column", type: "text", notNull: true },
            company: { kind: "reference", target: "kco", cardinality: "one" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "kk" } });
    key = (await res.json()).key as string;
    acme = (await god().kco.create({ name: "Acme" })).id;
    globex = (await god().kco.create({ name: "Globex" })).id;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("a key com FK-shorthand (a ÚNICA forma que o tipo oferece) funciona", async () => {
    // `companyId` é o que `Partial<InferInsert>` expõe pra uma reference N:1 — sem casts.
    const r = await god().kstat.accumulate({ day: "d1", companyId: acme }, { hits: inc(3) });
    expect(r.hits).toBe(3);
    expect(r.companyId).toBe(acme);
  });

  it("acumula na MESMA linha (ON CONFLICT casa pela FK), não cria outra", async () => {
    await god().kstat.accumulate({ day: "d2", companyId: acme }, { hits: inc(10) });
    const again = await god().kstat.accumulate({ day: "d2", companyId: acme }, { hits: inc(5) });
    expect(again.hits).toBe(15); // somou no Postgres
    expect(await god().kstat.findMany({ day: "d2" })).toHaveLength(1); // uma linha só
  });

  it("a reference faz PARTE da chave: mesma `day`, company diferente → linha separada", async () => {
    await god().kstat.accumulate({ day: "d3", companyId: acme }, { hits: inc(1) });
    await god().kstat.accumulate({ day: "d3", companyId: globex }, { hits: inc(7) });
    const rows = await god().kstat.findMany({ day: "d3" });
    expect(rows).toHaveLength(2); // não colidiram — o tenant separa
    expect(rows.find((r) => r.companyId === acme)!.hits).toBe(1);
    expect(rows.find((r) => r.companyId === globex)!.hits).toBe(7);
  });

  it("o nome do CAMPO na key (`company`) também é aceito — mesmo campo, mesma linha", async () => {
    // O tipo não oferece essa forma, mas o `unique`/DDL falam assim; os dois convergem
    // no mesmo campo, então não podem produzir linhas diferentes.
    await god().kstat.accumulate({ day: "d4", companyId: acme }, { hits: inc(2) });
    const viaName = await god().kstat.accumulate({ day: "d4", company: acme } as never, { hits: inc(3) });
    expect(viaName.hits).toBe(5); // mergeou na mesma linha
    expect(await god().kstat.findMany({ day: "d4" })).toHaveLength(1);
  });

  it("key que não casa nenhum unique segue estourando (e sem sugerir beco sem saída)", async () => {
    await expect(god().kstat.accumulate({ day: "d5" }, { hits: inc(1) })).rejects.toThrow(/needs a unique key/);
  });
});
