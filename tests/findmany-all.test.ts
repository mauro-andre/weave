import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, int4, text } from "@mauroandre/weave-sdk";

// Report (Perfil MCP): findMany truncava calado em 20 (default), e o servidor tinha cap
// duro de 100 em qualquer leitura. Fix: findMany devolve TUDO (default 10k, sem cap
// silencioso); `limit` sobe/desce; o cap de 100 do servidor foi removido (paginate maior
// funciona). É o idioma do zodMongo (default 10k) — PodCubo migra sem quebrar.

const thing = defineEntity("famthing", { n: int4().notNull(), label: text().notNull() });

describe("findMany devolve a lista inteira (fim do cap silencioso de 20)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities: { famthing: thing }, fetch: (r) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS famthing CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'famthing'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "famthing",
          fields: { n: { kind: "column", type: "int4", notNull: true }, label: { kind: "column", type: "text", notNull: true } },
        });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "fam key" } });
    key = (await res.json()).key as string;

    // 250 linhas — bem acima dos caps antigos (20 default / 100 duro).
    await weave().famthing.createMany(Array.from({ length: 250 }, (_, i) => ({ n: i, label: `L${i}` })));
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("findMany() devolve TODAS as 250 (não trunca em 20 nem em 100)", async () => {
    const all = await weave().famthing.findMany();
    expect(all.length).toBe(250);
  });

  it("findMany com limit devolve exatamente o pedido", async () => {
    const some = await weave().famthing.findMany({}, { limit: 10, orderBy: { n: "asc" } });
    expect(some.length).toBe(10);
    expect(some[0]!.n).toBe(0);
    expect(some[9]!.n).toBe(9);
  });

  it("paginate com perPage > 100 funciona (cap duro removido)", async () => {
    const page = await weave().famthing.paginate({}, { page: 1, perPage: 200 });
    expect(page.docs.length).toBe(200); // antes travava em 100
    expect(page.docsQuantity).toBe(250);
  });
});
