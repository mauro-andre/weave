import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";

// Peça 2 (FK diferida) end-to-end: ciclo mútuo REAL — cyc_company.consultant → cyc_users
// e cyc_users.company → cyc_company. Aplica UMA por vez (como o push faz), na ordem
// company→users, que exercita o caminho difícil: ao aplicar company o alvo `cyc_users`
// ainda não existe → a coluna/FK é adiada; ao aplicar users, o diff RECONCILIA (cria a
// coluna consultant_id que faltou + as duas FKs). Prova: as 2 FKs existem e são impostas.

describe("ciclo mútuo (FK diferida + reconciliação) — end-to-end", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const KEY = () => ({ "x-api-key": key });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS cyc_company, cyc_users CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('cyc_company', 'cyc_users')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        // company PRIMEIRO — referencia cyc_users, que ainda não existe (FK adiada).
        await applyEntity({
          irVersion: 1,
          name: "cyc_company",
          fields: {
            name: { kind: "column", type: "text", notNull: true },
            consultant: { kind: "reference", target: "cyc_users", cardinality: "one" }, // nullable
          },
        });
        // users DEPOIS — fecha o ciclo; aqui o diff reconcilia company.consultant_id + as 2 FKs.
        await applyEntity({
          irVersion: 1,
          name: "cyc_users",
          fields: {
            email: { kind: "column", type: "text", notNull: true },
            company: { kind: "reference", target: "cyc_company", cardinality: "one", notNull: true },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "cyc key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("as DUAS FKs do ciclo existem (reconciliadas)", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = await db()<{ table_name: string; column_name: string }[]>`
      select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
        and tc.table_name in ('cyc_company', 'cyc_users')`;
    const pairs = rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
    expect(pairs).toEqual(["cyc_company.consultant_id", "cyc_users.company_id"]);
  });

  it("a coluna adiada (company.consultant_id) foi criada na reconciliação", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const cols = await db()<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'cyc_company' and column_name = 'consultant_id'`;
    expect(cols).toHaveLength(1);
  });

  it("insert respeita o ciclo: company → user → aponta consultant de volta", async () => {
    // company sem consultant (nullable), depois user na company, depois fecha o laço.
    const company = await (await app.post("/api/cyc_company", { headers: KEY(), body: { name: "Acme" } })).json();
    const user = await (
      await app.post("/api/cyc_users", { headers: KEY(), body: { email: "a@x.com", companyId: company.id } })
    ).json();
    expect(user.companyId).toBe(company.id);

    const patched = await (
      await app.patch("/api/cyc_company", {
        headers: KEY(),
        query: { where: JSON.stringify({ id: company.id }) },
        body: { consultantId: user.id },
      })
    ).json();
    expect(patched.consultantId).toBe(user.id);
  });

  it("a FK é IMPOSTA: user com company inexistente falha", async () => {
    const res = await app.post("/api/cyc_users", {
      headers: KEY(),
      body: { email: "b@x.com", companyId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400); // violação de FK barrada pelo Postgres
  });
});
