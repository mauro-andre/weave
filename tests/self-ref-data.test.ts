import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, reference, array, self, genProject } from "@mauroandre/weave-sdk";

// Peça 1 end-to-end: self-ref N:N (o `users.directManagers → users` do Perfil MCP),
// modelado com `reference(array(self()))`. Prova as camadas que o self() atravessa:
//  - DDL: a join table `member__direct_managers` (2 FKs pra `member`) sobe (self-ref
//    N:N já suportado no emit — só o CICLO MÚTUO fica pra Peça 2).
//  - fromIR: reconstrução (2 passadas) liga a reference à própria entity.
//  - serialize (revive do client): resolve o self() pra própria forma (Dates revividas).
//  - gen: emite `reference(array(self()))` sem auto-import.

// Entity-as-code com self-ref, exatamente como o dev/gen escreveria.
const member = defineEntity("member", {
  name: text().notNull(),
  directManagers: reference(array(self())), // N:N pra si mesma
});

describe("self-ref N:N (reference(array(self()))) — end-to-end", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities: { member }, fetch: (req) => app.hono.fetch(req) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS member__direct_managers, member CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'member'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "member",
          fields: {
            name: { kind: "column", type: "text", notNull: true },
            directManagers: { kind: "reference", target: "member", cardinality: "many" }, // self N:N
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "selfref key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("a join table self-ref foi criada (DDL aceita self N:N)", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = await db()<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'member__direct_managers'`;
    expect(rows).toHaveLength(1);
  });

  it("cria, linka e lê via expand pelo SDK (revive resolve o self())", async () => {
    const w = weave();
    const a = await w.member.create({ name: "A" });
    const b = await w.member.create({ name: "B", directManagersIds: [a.id] });
    const c = await w.member.create({ name: "C", directManagersIds: [a.id, b.id] });

    const read = await w.member.findOne({ id: c.id }, { expand: { directManagers: true } });
    expect((read!.directManagers as { id: string }[]).map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    // prova que o reviveShape resolveu o self() pra própria forma: os Dates aninhados viraram Date.
    expect((read!.directManagers as { createdAt: unknown }[])[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("updateOne troca o set self-ref (o fix N:N vale pra self também)", async () => {
    const w = weave();
    const a = await w.member.create({ name: "mA" });
    const b = await w.member.create({ name: "mB" });
    const x = await w.member.create({ name: "mX", directManagersIds: [a.id, b.id] });

    await w.member.updateOne({ id: x.id }, { directManagersIds: [b.id] });
    const read = await w.member.findOne({ id: x.id }, { expand: { directManagers: true } });
    expect((read!.directManagers as { id: string }[]).map((m) => m.id)).toEqual([b.id]); // trocou
  });

  it("genProject emite reference(array(self())) sem auto-import", async () => {
    const project = await genProject({ url: "http://localhost", key, fetch: (req) => app.hono.fetch(req) });
    const src = project.files["entities/member.ts"]!;
    expect(src).toContain("directManagers: reference(array(self()))");
    expect(src).not.toContain('import member from "./member.js";'); // não importa a si mesmo
  });
});
