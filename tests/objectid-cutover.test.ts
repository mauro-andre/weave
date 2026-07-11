import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, reference } from "@mauroandre/weave-sdk";

// Cutover Mongo→Weave: WEAVE_ID_TYPE=objectId torna id/FK `char(24)` e o servidor gera
// ObjectId-compatible. A migração insere PRESERVANDO os ObjectIds (Weave já aceita id
// provido) → os links do front (string de 24 hex) continuam valendo. Linha nova gera
// ObjectId. As tabelas internas do Weave (weave_entities…) seguem uuid.

const author = defineEntity("oidauthor", { name: text().notNull() });
const book = defineEntity("oidbook", { title: text().notNull(), author: reference(author).notNull() });

describe("WEAVE_ID_TYPE=objectId — cutover end-to-end", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const prevEnv = process.env.WEAVE_ID_TYPE;
  const weave = () => createClient({ url: "http://localhost", key, entities: { oidauthor: author, oidbook: book }, fetch: (r) => app.hono.fetch(r) });

  beforeAll(async () => {
    process.env.WEAVE_ID_TYPE = "objectId";
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS oidbook, oidauthor CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('oidbook', 'oidauthor')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "oidauthor", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "oidbook",
          fields: {
            title: { kind: "column", type: "text", notNull: true },
            author: { kind: "reference", target: "oidauthor", cardinality: "one", notNull: true },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "oid key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
    if (prevEnv === undefined) delete process.env.WEAVE_ID_TYPE;
    else process.env.WEAVE_ID_TYPE = prevEnv;
  });

  it("a coluna id (e a FK) é char(24), não uuid", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const cols = await db()<{ column_name: string; data_type: string; len: number | null }[]>`
      select column_name, data_type, character_maximum_length as len
      from information_schema.columns
      where table_schema='public' and table_name='oidbook' and column_name in ('id', 'author_id')`;
    for (const c of cols) {
      expect(c.data_type).toBe("character"); // char(n)
      expect(c.len).toBe(24);
    }
    // internas seguem uuid (não são o modelo de dados ObjectId do consumidor)
    const w = await db()<{ data_type: string }[]>`
      select data_type from information_schema.columns where table_name='weave_users' and column_name='id'`;
    expect(w[0]!.data_type).toBe("uuid");
  });

  it("migração: insert preservando os ObjectIds → id mantido e FK bate (link intacto)", async () => {
    const AID = "507f1f77bcf86cd799439011"; // ObjectId real vindo do Mongo
    const BID = "507f191e810c19729de860ea";
    const a = await weave().oidauthor.create({ id: AID, name: "Ada" });
    expect(a.id).toBe(AID); // preservado, não regerado

    const b = await weave().oidbook.create({ id: BID, title: "T", authorId: AID });
    expect(b.id).toBe(BID);
    expect(b.authorId).toBe(AID); // FK guarda a mesma string de 24 hex

    // o link resolve: expand da reference pela FK ObjectId
    const read = await weave().oidbook.findOne({ id: BID }, { expand: { author: true } });
    expect((read!.author as { name: string }).name).toBe("Ada");
  });

  it("linha nova sem id → gera um ObjectId (24 hex)", async () => {
    const a = await weave().oidauthor.create({ name: "generated" });
    expect(a.id).toMatch(/^[0-9a-f]{24}$/);
  });
});
