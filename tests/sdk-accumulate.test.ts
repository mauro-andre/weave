import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import {
  createClient,
  defineEntity,
  text,
  int4,
  float8,
  timestamptz,
  inc,
  max,
  min,
  setOnInsert,
} from "@mauroandre/weave-sdk";

// Tier HISTÓRICO de ponta a ponta (o 1º consumidor real: telemetria do PodCubo).
// `accumulate(key, ops)` = upsert mergeável na chave (o unique composto), com a
// acumulação NO POSTGRES. Guarda mergeável (sum/count/min/max), deriva a média na
// leitura — nunca guarda média pronta (§0).
const metric = defineEntity(
  "metricAgg",
  {
    workerId: text().notNull(),
    name: text().notNull(),
    ts: timestamptz().notNull(),
    sampleCount: int4().notNull().default(0),
    cpuSum: float8().notNull().default(0),
    cpuMax: float8().notNull().default(0),
    cpuMin: float8().notNull().default(0),
    firstSeen: timestamptz(),
  },
  { unique: [["workerId", "name", "ts"]] }, // a chave de rollup (§5)
);
const entities = { metricAgg: metric };

const BASE = 1700000100;
const bucket = (offsetSec: number) => new Date((BASE + offsetSec) * 1000);

describe("SDK accumulate — tier histórico (upsert mergeável)", () => {
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
        await sql`DROP TABLE IF EXISTS metric_agg CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'metric_agg'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "metricAgg",
          fields: {
            workerId: { kind: "column", type: "text", notNull: true },
            name: { kind: "column", type: "text", notNull: true },
            ts: { kind: "column", type: "timestamptz", notNull: true },
            sampleCount: { kind: "column", type: "int4", notNull: true, default: 0 },
            cpuSum: { kind: "column", type: "float8", notNull: true, default: 0 },
            cpuMax: { kind: "column", type: "float8", notNull: true, default: 0 },
            cpuMin: { kind: "column", type: "float8", notNull: true, default: 0 },
            firstSeen: { kind: "column", type: "timestamptz" },
          },
          unique: [["workerId", "name", "ts"]],
        });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "acc test key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("1ª chamada INSERE e devolve a linha (inc-and-return)", async () => {
    const row = await weave().metricAgg.accumulate(
      { workerId: "w1", name: "cpu", ts: bucket(0) },
      { sampleCount: inc(1), cpuSum: inc(2), cpuMax: max(2), cpuMin: min(2), firstSeen: setOnInsert(bucket(0)) },
    );
    expect(row.id).toBeTruthy();
    expect(row.sampleCount).toBe(1);
    expect(row.cpuSum).toBeCloseTo(2, 6);
    expect(row.cpuMax).toBeCloseTo(2, 6);
    expect(row.cpuMin).toBeCloseTo(2, 6);
    expect((row.firstSeen as Date).toISOString()).toBe(bucket(0).toISOString());
  });

  it("2ª chamada na MESMA chave MERGEIA: contador soma, pico sobe, vale desce, setOnInsert preserva", async () => {
    const row = await weave().metricAgg.accumulate(
      { workerId: "w1", name: "cpu", ts: bucket(0) },
      { sampleCount: inc(1), cpuSum: inc(5), cpuMax: max(5), cpuMin: min(5), firstSeen: setOnInsert(bucket(999)) },
    );
    expect(row.sampleCount).toBe(2); // 1 + 1
    expect(row.cpuSum).toBeCloseTo(7, 6); // 2 + 5
    expect(row.cpuMax).toBeCloseTo(5, 6); // greatest(2, 5)
    expect(row.cpuMin).toBeCloseTo(2, 6); // least(2, 5) — o vale de antes fica
    // média DERIVADA na leitura (nunca guardada): cpuSum/sampleCount = 7/2.
    expect(row.cpuSum / row.sampleCount).toBeCloseTo(3.5, 6);
    // setOnInsert: gravou no 1º insert e NÃO mudou no merge (preservou o firstSeen).
    expect((row.firstSeen as Date).toISOString()).toBe(bucket(0).toISOString());
  });

  it("3ª chamada com valor MENOR: o pico se mantém, o vale afunda", async () => {
    const row = await weave().metricAgg.accumulate(
      { workerId: "w1", name: "cpu", ts: bucket(0) },
      { sampleCount: inc(1), cpuMax: max(1), cpuMin: min(1) },
    );
    expect(row.sampleCount).toBe(3);
    expect(row.cpuMax).toBeCloseTo(5, 6); // greatest(5, 1) — pico intacto
    expect(row.cpuMin).toBeCloseTo(1, 6); // least(2, 1) — novo vale
    expect(row.cpuSum).toBeCloseTo(7, 6); // não incrementado nesta chamada → intacto
  });

  it("chave diferente (outro bucket) = OUTRA linha; a série coexiste", async () => {
    await weave().metricAgg.accumulate(
      { workerId: "w1", name: "cpu", ts: bucket(300) },
      { sampleCount: inc(1), cpuSum: inc(9), cpuMax: max(9), cpuMin: min(9) },
    );
    const rows = await weave().metricAgg.findMany({ workerId: "w1", name: "cpu" }, { orderBy: { ts: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sampleCount).toBe(3); // bucket 0 acumulou 3 vezes
    expect(rows[1]!.sampleCount).toBe(1); // bucket 300, uma vez
  });

  it("chave que não casa com o unique declarado → erro (não escreve nada)", async () => {
    await expect(
      weave().metricAgg.accumulate({ workerId: "w1" }, { sampleCount: inc(1) }),
    ).rejects.toThrow(/unique key/i);
  });
});
