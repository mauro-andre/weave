import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, int4, timestamptz, reference, count } from "@mauroandre/weave-sdk";

// Gap reportado (Perfil MCP): aggregate/groupBy/latestPer não aceitava agrupar por
// reference (o hotspot de stats: por department/company/respondent). O `aggCol` só
// reconhecia coluna escalar. Fix: reference N:1 → agrupa pela FK `<campo>_id`.

const resp = defineEntity("aggresp", { name: text().notNull() });
const answer = defineEntity("agganswer", {
  respondent: reference(resp).notNull(),
  score: int4().notNull(),
  ts: timestamptz().notNull(),
});

describe("aggregate/latestPer por REFERENCE (agrupa pela FK)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities: { aggresp: resp, agganswer: answer }, fetch: (r) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS agganswer, aggresp CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('agganswer', 'aggresp')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "aggresp", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "agganswer",
          fields: {
            respondent: { kind: "reference", target: "aggresp", cardinality: "one", notNull: true },
            score: { kind: "column", type: "int4", notNull: true },
            ts: { kind: "column", type: "timestamptz", notNull: true },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "agg key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("groupBy por reference → conta por respondent (agrupa pela FK)", async () => {
    const w = weave();
    const a = await w.aggresp.create({ name: "A" });
    const b = await w.aggresp.create({ name: "B" });
    await w.agganswer.create({ respondentId: a.id, score: 1, ts: new Date("2026-01-01T10:00:00Z") });
    await w.agganswer.create({ respondentId: a.id, score: 2, ts: new Date("2026-01-02T10:00:00Z") });
    await w.agganswer.create({ respondentId: b.id, score: 3, ts: new Date("2026-01-01T10:00:00Z") });

    const rows = await w.agganswer.aggregate({ groupBy: ["respondent"], select: { n: count() } });
    const byResp = new Map(rows.map((r) => [r.respondent as string, Number(r.n)]));
    expect(byResp.get(a.id)).toBe(2); // A tem 2 respostas
    expect(byResp.get(b.id)).toBe(1); // B tem 1
  });

  it("latestPer por reference → uma linha por respondent (a mais recente)", async () => {
    const w = weave();
    const rows = await w.agganswer.findMany({}, { latestPer: ["respondent"], orderBy: { ts: "desc" } });
    // uma linha por respondent (A e B), a de maior ts
    const byResp = new Map(rows.map((r) => [r.respondentId as string, r.score as number]));
    expect(byResp.size).toBe(2);
    // A: a resposta mais recente é score 2 (ts 2026-01-02)
    const a = rows.find((r) => r.score === 2);
    expect(a).toBeDefined();
    expect([...byResp.values()].sort()).toEqual([2, 3]); // A→2 (recente), B→3
  });

  it("`respondentId` também funciona (forma FK direta)", async () => {
    const w = weave();
    const rows = await w.agganswer.aggregate({ groupBy: ["respondentId"], select: { n: count() } });
    expect(rows.length).toBe(2); // 2 grupos (A, B)
  });
});
