import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, int4, timestamptz, timeBucket, count } from "@mauroandre/weave-sdk";
import { __resetPartitionCache } from "../app/engine/control-plane/partition.js";

// Retenção por partição de ponta a ponta (tier recente cru — o caso appRequest do
// PodCubo). Particiona por dia, retém 7d. Invariantes: (1) dias distintos → partições
// distintas; (2) além da retenção → pulado no ingest + partição velha dropada no
// rollover; (3) leitura atravessa as partições (pruning transparente).
const appReq = defineEntity(
  "appReq",
  {
    host: text().notNull(),
    route: text().notNull(),
    ts: timestamptz().notNull(),
    status: int4().notNull(),
  },
  { partitionBy: timeBucket("ts", "1d"), retention: "7d" },
);
const entities = { appReq };

const DAY = 86_400_000;
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY; // meia-noite UTC (epoch alinhado)
const today0 = dayStart(Date.now());
const at = (dayOffset: number, hour = 1) => new Date(today0 + dayOffset * DAY + hour * 3_600_000);
const isoDay = (dayOffset: number) => new Date(today0 + dayOffset * DAY).toISOString();

describe("SDK partition retention — tier recente cru (append-only)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () => createClient({ url: "http://localhost", key, entities, fetch: (req) => app.hono.fetch(req) });

  // Lista as partições reais do pai (do catálogo).
  const partitions = async (): Promise<string[]> => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = (await db().unsafe(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid ` +
        `JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='app_req' ORDER BY name`,
    )) as unknown as { name: string }[];
    return rows.map((r) => r.name);
  };

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS app_req CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'app_req'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "appReq",
          fields: {
            host: { kind: "column", type: "text", notNull: true },
            route: { kind: "column", type: "text", notNull: true },
            ts: { kind: "column", type: "timestamptz", notNull: true },
            status: { kind: "column", type: "int4", notNull: true },
          },
          partitionBy: { field: "ts", interval: "1d" },
          retention: "7d",
        });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "part test key" } });
    key = (await res.json()).key as string;
    __resetPartitionCache();
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("a tabela pai é particionada por RANGE (ts)", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = (await db().unsafe(
      `SELECT partstrat FROM pg_partitioned_table pt JOIN pg_class c ON c.oid=pt.partrelid WHERE c.relname='app_req'`,
    )) as unknown as { partstrat: string }[];
    expect(rows[0]?.partstrat).toBe("r"); // 'r' = RANGE
  });

  it("dias distintos → partições distintas (ensure lazy pela ts do evento)", async () => {
    // hoje + ontem, ambos dentro dos 7d. O ensure garante a partição de cada `ts`.
    const rows = await weave().appReq.createMany([
      { host: "h1", route: "/a", ts: at(0), status: 200 },
      { host: "h1", route: "/b", ts: at(-1), status: 200 }, // ontem
    ]);
    expect(rows).toHaveLength(2);
    const parts = await partitions();
    expect(parts).toContain(`app_req_${isoDay(0).slice(0, 10).replace(/-/g, "_")}`); // hoje
    expect(parts).toContain(`app_req_${isoDay(-1).slice(0, 10).replace(/-/g, "_")}`); // ontem
  });

  it("leitura atravessa as partições (pruning transparente)", async () => {
    const found = await weave().appReq.findMany({ host: "h1" }, { orderBy: { ts: "asc" } });
    expect(found).toHaveLength(2);
    const agg = await weave().appReq.aggregate({ where: { host: "h1" }, select: { n: count() } });
    expect(Number(agg[0]!.n)).toBe(2);
  });

  it("createMany pula as linhas além da retenção (>7d), insere as frescas", async () => {
    const rows = await weave().appReq.createMany([
      { host: "h3", route: "/x", ts: at(-10), status: 200 }, // 10d atrás → além dos 7d → pulada
      { host: "h3", route: "/y", ts: at(0), status: 200 }, // hoje → entra
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.route).toBe("/y");
    const found = await weave().appReq.findMany({ host: "h3" });
    expect(found).toHaveLength(1); // a de 10d atrás nunca entrou
  });

  it("dropa a partição expirada no rollover", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    // Simula uma partição VELHA (10d atrás) criada quando ainda estava na janela — o
    // ingest normal não a criaria (pula). Topo = 9d atrás <= now-7d → expirada.
    const from = isoDay(-10);
    const to = isoDay(-9);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS app_req_stale PARTITION OF app_req FOR VALUES FROM ('${from}') TO ('${to}')`,
    );
    expect(await partitions()).toContain("app_req_stale");

    // Um write que ABRE um bucket novo dispara o sweep de expiradas (self-clocking).
    __resetPartitionCache(); // força openedNew no próximo write
    await weave().appReq.createMany([{ host: "h5", route: "/z", ts: at(0), status: 200 }]);

    expect(await partitions()).not.toContain("app_req_stale"); // dropada
  });
});
