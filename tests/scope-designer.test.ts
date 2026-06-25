import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_saveScope } from "../app/pages/ScopeDesigner.js";

describe("scope designer (GUI)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let master: { id: string };

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS thing CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'thing'`;
        await sql`DELETE FROM weave_scopes WHERE name = 's1'`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "thing", fields: { label: { kind: "column", type: "text" } } });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("SSR: /scopes/new renderiza", async () => {
    const res = await app.as({ user: master }).get("/scopes/new");
    expect(res.status).toBe(200);
  });

  it("salva e relê um scope (action → control-plane), e o editor carrega", async () => {
    const { getEntity } = await import("../app/engine/control-plane/entities.js");
    const fid = (await getEntity("thing"))!.fields.label!.id!;
    const scope = {
      name: "s1",
      entities: {
        thing: {
          verbs: ["read" as const],
          rows: { path: [fid], op: "equals", value: { param: "x" } },
          fields: { mode: "exclude" as const, paths: [[fid]] },
        },
      },
    };
    const res = await app.as({ user: master }).action(action_saveScope, { body: { scope } });
    expect((await res.json()).ok).toBe(true);

    const { getScope } = await import("../app/engine/control-plane/scopes.js");
    const got = (await getScope("s1"))!;
    expect(got.entities.thing!.verbs).toEqual(["read"]);
    expect(got.entities.thing!.fields).toMatchObject({ mode: "exclude" });

    const ssr = await app.as({ user: master }).get("/scopes/s1");
    expect(ssr.status).toBe(200); // o editor decodifica e renderiza
  });
});
