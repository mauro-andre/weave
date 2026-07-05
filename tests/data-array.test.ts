import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";

// Round-trip de colunas de LISTA via REST: escreve `text[]` e `int4[]` (o texto com vírgula
// E quebra de linha dentro de um elemento), lê de volta e confere que veio idêntico. Prova
// que o array trafega como array JSON puro — a vírgula da UI nunca tocou a API — e que o
// Postgres guarda cada elemento inteiro (vírgula/\n são conteúdo, não delimitador).

describe("Data — colunas de lista (text[] / int4[]) round-trip", () => {
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
        await sql`DROP TABLE IF EXISTS arrbox CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'arrbox'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "arrbox",
          fields: {
            title: { kind: "column", type: "text" },
            tags: { kind: "column", type: "text", array: true }, // text[]
            scores: { kind: "column", type: "int4", array: true }, // int4[]
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "arr key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("escreve text[] (com vírgula e \\n) e int4[], lê de volta idêntico", async () => {
    const tags = ["urgent", "tem, vírgula", "linha1\nlinha2"];
    const scores = [10, 20, 30];

    const post = await app.post("/api/arrbox", { headers: KEY(), body: { title: "t1", tags, scores } });
    expect(post.status).toBe(201);
    const created = await post.json();
    const id = created.id as string;
    // já volta certo na própria resposta do create
    expect(created.tags).toEqual(tags);
    expect(created.scores).toEqual(scores);

    // e na leitura por id (o que interessa: escreve → lê)
    const got = await (await app.get(`/api/arrbox/${id}`, { headers: KEY() })).json();
    expect(got.tags).toEqual(tags); // vírgula e quebra de linha preservadas, elemento a elemento
    expect(got.scores).toEqual(scores);
    expect(Array.isArray(got.tags)).toBe(true); // é array JSON, não string
  });

  it("lista vazia trafega como [] (não null)", async () => {
    const post = await app.post("/api/arrbox", { headers: KEY(), body: { title: "t2", tags: [], scores: [] } });
    const id = (await post.json()).id as string;
    const got = await (await app.get(`/api/arrbox/${id}`, { headers: KEY() })).json();
    expect(got.tags).toEqual([]);
    expect(got.scores).toEqual([]);
  });

  it("PATCH substitui a lista inteira", async () => {
    const post = await app.post("/api/arrbox", { headers: KEY(), body: { title: "t3", tags: ["a"], scores: [1] } });
    const id = (await post.json()).id as string;

    const patched = await (
      await app.patch("/api/arrbox", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { tags: ["x", "y"] } })
    ).json();
    expect(patched.tags).toEqual(["x", "y"]); // trocou
    expect(patched.scores).toEqual([1]); // preservado (merge)
  });
});
