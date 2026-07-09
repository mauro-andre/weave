import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, reference, array } from "@mauroandre/weave-sdk";

// Regressão do bug reportado na migração do Perfil MCP (primeiro projeto com N:N):
// updateOne/updateMany com `<field>Ids` de um reference(array) (N:N) era silenciosamente
// IGNORADO — a junção nunca era substituída nem limpa. Causa: o update lê o objeto atual
// com auto-expand (a reference N:N volta como array de objetos), faz merge com o patch e
// chama `saveObject`; o `normalizeRefs` re-derivava `<field>Ids` a partir do array antigo
// expandido, sobrescrevendo o que veio no patch. O branch N:1 já tinha a precedência do
// FK explícito; o N:N ficou de fora. Este teste bate no caminho REST real (PATCH /api/...).

describe("Data — N:N update via <field>Ids (replace/clear/preserve)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let A = "", B = "", C = "";
  const KEY = () => ({ "x-api-key": key });

  // Link set atual de um statement, lido via expand (o caminho que o bug report diz OK).
  const anchorsOf = async (id: string): Promise<string[]> => {
    const res = await app.get("/api/statement", {
      headers: KEY(),
      query: { where: JSON.stringify({ id }), expand: JSON.stringify({ careerAnchors: true }) },
    });
    const docs = (await res.json()).docs as { careerAnchors: { id: string }[] }[];
    return (docs[0]?.careerAnchors ?? []).map((a) => a.id).sort();
  };

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS statement__career_anchors, statement, anchor CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('statement', 'anchor')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        // anchor primeiro (statement referencia anchor — ordem topológica).
        await applyEntity({
          irVersion: 1,
          name: "anchor",
          fields: { label: { kind: "column", type: "text", notNull: true } },
        });
        await applyEntity({
          irVersion: 1,
          name: "statement",
          fields: {
            text: { kind: "column", type: "text", notNull: true },
            careerAnchors: { kind: "reference", target: "anchor", cardinality: "many" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "nn key" } });
    key = (await res.json()).key as string;

    const mk = async (label: string) =>
      (await (await app.post("/api/anchor", { headers: KEY(), body: { label } })).json()).id as string;
    A = await mk("A");
    B = await mk("B");
    C = await mk("C");
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("create grava o set N:N via careerAnchorsIds", async () => {
    const post = await app.post("/api/statement", { headers: KEY(), body: { text: "s1", careerAnchorsIds: [A, B] } });
    expect(post.status).toBe(201);
    const id = (await post.json()).id as string;
    expect(await anchorsOf(id)).toEqual([A, B].sort());
  });

  it("updateOne troca o set (replace) — o bug", async () => {
    const id = (await (await app.post("/api/statement", { headers: KEY(), body: { text: "s2", careerAnchorsIds: [A, B] } })).json()).id as string;

    await app.patch("/api/statement", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { careerAnchorsIds: [B] } });
    expect(await anchorsOf(id)).toEqual([B]); // trocou para {B}, não ficou {A,B}
  });

  it("updateOne cresce o set", async () => {
    const id = (await (await app.post("/api/statement", { headers: KEY(), body: { text: "s3", careerAnchorsIds: [A] } })).json()).id as string;

    await app.patch("/api/statement", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { careerAnchorsIds: [A, B, C] } });
    expect(await anchorsOf(id)).toEqual([A, B, C].sort());
  });

  it("updateOne com [] LIMPA o set", async () => {
    const id = (await (await app.post("/api/statement", { headers: KEY(), body: { text: "s4", careerAnchorsIds: [A, B] } })).json()).id as string;

    await app.patch("/api/statement", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { careerAnchorsIds: [] } });
    expect(await anchorsOf(id)).toEqual([]); // limpou
  });

  it("updateOne SEM careerAnchorsIds preserva o set (omissão ≠ limpar)", async () => {
    const id = (await (await app.post("/api/statement", { headers: KEY(), body: { text: "s5", careerAnchorsIds: [A, B] } })).json()).id as string;

    await app.patch("/api/statement", { headers: KEY(), query: { where: JSON.stringify({ id }) }, body: { text: "s5-renomeado" } });
    expect(await anchorsOf(id)).toEqual([A, B].sort()); // intacto — só o campo escalar mudou
  });
});

// Mesma correção, agora provada pelo CLIENT DO SDK (createClient) — não REST cru. O fix é
// server-side, então o SDK (casca fina de HTTP que já manda `<field>Ids` no body do PATCH)
// passa a funcionar sem mudar nada no pacote. Isto responde "funciona no SDK também?": sim.
const sdkAnchor = defineEntity("sdknnanchor", { label: text().notNull() });
const sdkStatement = defineEntity("sdknnstatement", {
  text: text().notNull(),
  careerAnchors: reference(array(sdkAnchor)),
});
const sdkEntities = { sdknnanchor: sdkAnchor, sdknnstatement: sdkStatement };

describe("SDK client — N:N update via careerAnchorsIds (replace/clear)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities: sdkEntities, fetch: (req) => app.hono.fetch(req) });
  const ids = (s: { careerAnchors: { id: string }[] } | null) => (s?.careerAnchors ?? []).map((a) => a.id).sort();

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS sdknnstatement__career_anchors, sdknnstatement, sdknnanchor CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('sdknnstatement', 'sdknnanchor')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "sdknnanchor", fields: { label: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "sdknnstatement",
          fields: {
            text: { kind: "column", type: "text", notNull: true },
            careerAnchors: { kind: "reference", target: "sdknnanchor", cardinality: "many" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "sdk nn key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("updateOne pelo SDK troca e limpa o set N:N", async () => {
    const w = weave();
    const a = await w.sdknnanchor.create({ label: "A" });
    const b = await w.sdknnanchor.create({ label: "B" });

    const s = await w.sdknnstatement.create({ text: "s1", careerAnchorsIds: [a.id, b.id] });
    const read = (id: string) => w.sdknnstatement.findOne({ id }, { expand: { careerAnchors: true } });
    expect(ids(await read(s.id))).toEqual([a.id, b.id].sort());

    await w.sdknnstatement.updateOne({ id: s.id }, { careerAnchorsIds: [b.id] });
    expect(ids(await read(s.id))).toEqual([b.id]); // trocou pelo SDK

    await w.sdknnstatement.updateOne({ id: s.id }, { careerAnchorsIds: [] });
    expect(ids(await read(s.id))).toEqual([]); // limpou pelo SDK
  });
});
