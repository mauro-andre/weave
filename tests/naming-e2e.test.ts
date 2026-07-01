import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text } from "@mauroandre/weave-sdk";

// Round-trip de campo camelCase multi-palavra (o bug que o `slug` causava): o dev
// escreve `firstName` no código, o Postgres guarda `first_name`, e a leitura volta
// como `firstName` — batendo com o código. Antes, `slug` colapsava pra `firstname`
// e a chave sumia no revive do SDK.

const person = defineEntity("nameperson", {
  firstName: text().notNull(),
  phoneNumber: text(),
});
const entities = { nameperson: person };

describe("naming e2e — camelCase no código ↔ snake_case no PG", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities, fetch: (req) => app.hono.fetch(req) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS nameperson CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'nameperson'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "nameperson",
          fields: {
            firstName: { kind: "column", type: "text", notNull: true },
            phoneNumber: { kind: "column", type: "text" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "naming key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("a coluna no Postgres é snake_case (first_name / phone_number)", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const cols = await db()<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'nameperson'`;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("first_name");
    expect(names).toContain("phone_number");
    expect(names).not.toContain("firstname"); // NÃO colapsou
  });

  it("create/read: firstName sobrevive o round-trip (chave camelCase bate)", async () => {
    const w = weave();
    const created = await w.nameperson.create({ firstName: "Ada", phoneNumber: "555-0100" });
    expect(created.firstName).toBe("Ada");
    expect(created.phoneNumber).toBe("555-0100");

    const got = await w.nameperson.findOne({ firstName: "Ada" }); // where por campo camelCase
    expect(got?.firstName).toBe("Ada");
    expect(got?.phoneNumber).toBe("555-0100");
  });

  it("where/update por campo camelCase (shorthand + snake por baixo)", async () => {
    const w = weave();
    await w.nameperson.create({ firstName: "Grace", phoneNumber: "555-0200" });

    const many = await w.nameperson.findMany({ phoneNumber: "555-0200" });
    expect(many.some((p) => p.firstName === "Grace")).toBe(true);

    const upd = await w.nameperson.updateOne({ firstName: "Grace" }, { phoneNumber: "555-9999" });
    expect(upd?.phoneNumber).toBe("555-9999");
    expect(upd?.firstName).toBe("Grace"); // merge preserva
  });
});
