import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { pushEntities, defineEntity, text, reference, array, self } from "@mauroandre/weave-sdk";

// Regressão do bug reportado pelo Perfil MCP na 0.0.29: `weave push` de um thunk lazy
// `reference(() => other)` falhava com "target must be a string". Meus testes de toIR
// eram isolados; ESTE exercita o CAMINHO REAL do push (pushEntities → toIR → POST
// /admin/push) com ciclo mútuo + self(), que é onde o bug aparece.

describe("SDK push — ciclo mútuo (thunk) + self-ref", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const opts = () => ({ url: "http://localhost", key, fetch: (r: Request) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS cyc2_users__direct_managers, cyc2_companies, cyc2_users CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('cyc2_companies', 'cyc2_users')`;
        await sql`DELETE FROM weave_api_keys`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "cyc push key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("push resolve o thunk `() => other` (não estoura 'target must be a string')", async () => {
    // companies referencia users (declarado depois) — o thunk adia; no push resolve.
    const companies = defineEntity("cyc2_companies", {
      name: text().notNull(),
      consultant: reference(() => users), // thunk lazy N:1 (nullable)
    });
    const users = defineEntity("cyc2_users", {
      email: text().notNull(),
      company: reference(() => companies).notNull(), // thunk lazy N:1 (notNull) — o que falhava
      directManagers: reference(array(self())), // self N:N
    });

    const res = await pushEntities({ companies, users }, opts());
    expect(res.review).toEqual([]); // nada retido
    expect(res.applied.sort()).toEqual(["cyc2_companies", "cyc2_users"]); // as duas aplicadas
  });
});
