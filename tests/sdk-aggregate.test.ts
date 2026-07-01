import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import {
  createClient,
  defineEntity,
  text,
  int4,
  timestamptz,
  count,
  sum,
  avg,
  distinct,
  percentile,
  timeBucket,
} from "@mauroandre/weave-sdk";

// Telemetria: uma requisição de app (host, quando, quanto durou, status). É o
// caso do PodCubo — a query-alvo é a série temporal por janela de 5 min.
const appreq = defineEntity("aggreq", {
  host: text().notNull(),
  ts: timestamptz().notNull(),
  durationMs: int4().notNull(),
  status: int4().notNull(),
});
const entities = { aggreq: appreq };

// Base num limite exato de bucket de 5 min (epoch % 300 === 0), pra a asserção
// da janela ser determinística: 1700000100 % 300 === 0.
const BASE = 1700000100;
const at = (offsetSec: number) => new Date((BASE + offsetSec) * 1000);
const iso = (offsetSec: number) => at(offsetSec).toISOString();

describe("SDK aggregate (F-agg) — groupBy + acumuladores + timeBucket", () => {
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
        await sql`DROP TABLE IF EXISTS aggreq CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'aggreq'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "aggreq",
          fields: {
            host: { kind: "column", type: "text", notNull: true },
            ts: { kind: "column", type: "timestamptz", notNull: true },
            durationMs: { kind: "column", type: "int4", notNull: true },
            status: { kind: "column", type: "int4", notNull: true },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "agg test key" } });
    key = (await res.json()).key as string;

    // 3 reqs no bucket 0 (a,a,b) + 1 no bucket seguinte (a, em +400s).
    const w = weave();
    await w.aggreq.create({ host: "a", ts: at(10), durationMs: 100, status: 200 });
    await w.aggreq.create({ host: "a", ts: at(50), durationMs: 200, status: 200 });
    await w.aggreq.create({ host: "b", ts: at(20), durationMs: 300, status: 500 });
    await w.aggreq.create({ host: "a", ts: at(400), durationMs: 50, status: 200 });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("série temporal: timeBucket('ts','5min') + count(), ordenada", async () => {
    const rows = await weave().aggreq.aggregate({
      groupBy: { ts: timeBucket("ts", "5min") },
      select: { requests: count() },
      orderBy: { ts: "asc" },
    });
    expect(rows).toHaveLength(2);
    // bucket 0 → 3 reqs; bucket +300s → 1 req.
    expect(new Date(rows[0]!.ts as string).toISOString()).toBe(iso(0));
    expect(Number(rows[0]!.requests)).toBe(3);
    expect(new Date(rows[1]!.ts as string).toISOString()).toBe(iso(300));
    expect(Number(rows[1]!.requests)).toBe(1);
  });

  it("groupBy host: count + sum + avg (durationMs → duration_ms)", async () => {
    const rows = await weave().aggreq.aggregate({
      groupBy: ["host"],
      select: { n: count(), total: sum("durationMs"), mean: avg("durationMs") },
      orderBy: { host: "asc" },
    });
    expect(rows).toHaveLength(2);

    const a = rows.find((r) => r.host === "a")!;
    const b = rows.find((r) => r.host === "b")!;
    expect(Number(a.n)).toBe(3);
    expect(Number(a.total)).toBe(350); // 100 + 200 + 50
    expect(Number(a.mean)).toBeCloseTo(350 / 3, 5);
    expect(Number(b.n)).toBe(1);
    expect(Number(b.total)).toBe(300);
  });

  it("conjunto inteiro (sem groupBy): uma linha agregada", async () => {
    const rows = await weave().aggreq.aggregate({
      select: { n: count(), total: sum("durationMs") },
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(4);
    expect(Number(rows[0]!.total)).toBe(650); // 100 + 200 + 300 + 50
  });

  it("where filtra antes de agregar (status = 200)", async () => {
    const rows = await weave().aggreq.aggregate({
      where: { status: 200 }, // shorthand → { status: { eq: 200 } }
      select: { n: count() },
    });
    expect(Number(rows[0]!.n)).toBe(3);
  });

  it("distinct: hosts únicos no conjunto (a, b → 2)", async () => {
    const rows = await weave().aggreq.aggregate({ select: { hosts: distinct("host") } });
    expect(Number(rows[0]!.hosts)).toBe(2);
  });

  it("percentile exato: p50 de [50,100,200,300] → 150 (mediana interpolada)", async () => {
    const rows = await weave().aggreq.aggregate({ select: { med: percentile("durationMs", 0.5) } });
    expect(Number(rows[0]!.med)).toBeCloseTo(150, 5);
  });

  it("acumulador com { where } → FILTER: total vs errors numa passada", async () => {
    const rows = await weave().aggreq.aggregate({
      select: {
        total: count(),
        errors: count({ where: { status: { gte: 500 } } }),
      },
    });
    expect(Number(rows[0]!.total)).toBe(4);
    expect(Number(rows[0]!.errors)).toBe(1); // só o req do host "b" (status 500)
  });

  it("having: só grupos com count >= 2 (host a; b fica de fora)", async () => {
    const rows = await weave().aggreq.aggregate({
      groupBy: ["host"],
      select: { n: count() },
      having: { n: { gte: 2 } },
      orderBy: { host: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.host).toBe("a");
    expect(Number(rows[0]!.n)).toBe(3);
  });

  it("top-N paginado: host mais movimentado (orderBy desc + perPage 1)", async () => {
    const rows = await weave().aggreq.aggregate({
      groupBy: ["host"],
      select: { n: count() },
      orderBy: { n: "desc" },
      page: 1,
      perPage: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.host).toBe("a"); // 3 > 1
  });
});
