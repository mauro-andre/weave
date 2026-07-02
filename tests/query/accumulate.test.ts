import { describe, it, expect } from "vitest";
import {
  compileAccumulate,
  inc,
  max,
  min,
  setOnInsert,
  defineEntity,
  text,
  int4,
  float8,
  timestamptz,
  reference,
} from "../../app/engine/index.js";

// Compilador do accumulate (tier histórico). SQL puro, sem DB: um upsert atômico
// cuja acumulação (inc/max/min) roda NO POSTGRES (`+`/`greatest`/`least`), com
// `setOnInsert` FORA do SET e `ON CONFLICT` no unique declarado.

const metric = defineEntity(
  "metric",
  {
    workerId: text().notNull(),
    name: text().notNull(),
    ts: timestamptz().notNull(),
    sampleCount: int4().notNull().default(0),
    cpuSum: float8().notNull().default(0),
    cpuMax: float8().notNull().default(0),
    cpuMin: float8().notNull().default(0),
  },
  { unique: [["workerId", "name", "ts"]] },
);

describe("compileAccumulate — upsert mergeável do tier histórico", () => {
  it("inc/max/min mergeiam no DO UPDATE; setOnInsert fica de fora; ON CONFLICT no composto", () => {
    const { text: sql, params } = compileAccumulate(
      metric,
      { workerId: "w1", name: "cpu", ts: new Date("2026-01-01T00:00:00Z") },
      {
        sampleCount: inc(1),
        cpuSum: inc(0.5),
        cpuMax: max(0.5),
        cpuMin: min(0.5),
      },
    );

    // INSERT: id (app-side) + colunas da chave + colunas das ops.
    expect(sql).toMatch(/^INSERT INTO metric \(id, worker_id, name, ts, sample_count, cpu_sum, cpu_max, cpu_min\)/);
    // ON CONFLICT no conjunto de colunas do unique composto.
    expect(sql).toContain("ON CONFLICT (worker_id, name, ts) DO UPDATE SET");
    // inc → soma; max → greatest; min → least (tudo NO POSTGRES).
    expect(sql).toContain("sample_count = metric.sample_count + excluded.sample_count");
    expect(sql).toContain("cpu_sum = metric.cpu_sum + excluded.cpu_sum");
    expect(sql).toContain("cpu_max = greatest(metric.cpu_max, excluded.cpu_max)");
    expect(sql).toContain("cpu_min = least(metric.cpu_min, excluded.cpu_min)");
    expect(sql).toContain("updated_at = now()");
    expect(sql).toContain("RETURNING *");

    // params: [id, workerId, name, ts, inc, inc, max, min].
    expect(typeof params[0]).toBe("string"); // uuid app-side
    expect(params.slice(1)).toEqual(["w1", "cpu", new Date("2026-01-01T00:00:00Z"), 1, 0.5, 0.5, 0.5]);
  });

  it("setOnInsert grava só no INSERT — não aparece no DO UPDATE SET", () => {
    const { text: sql } = compileAccumulate(
      metric,
      { workerId: "w1", name: "cpu", ts: new Date(0) },
      { sampleCount: inc(1), cpuSum: setOnInsert(3.14) },
    );
    expect(sql).toContain("cpu_sum"); // presente no INSERT (…, cpu_sum)
    expect(sql).not.toContain("cpu_sum ="); // ausente do SET (preserva no conflito)
  });

  it("op sobre uma coluna da CHAVE (ex.: ts) é no-op — não duplica a coluna no INSERT", () => {
    const { text: sql, params } = compileAccumulate(
      metric,
      { workerId: "w1", name: "cpu", ts: new Date(0) },
      { ts: setOnInsert(new Date(0)), sampleCount: inc(1) }, // ts redundante com a chave
    );
    // `ts` entra só pela CHAVE — a op redundante não adiciona uma segunda `ts`.
    expect(sql).toMatch(/\(id, worker_id, name, ts, sample_count\)/);
    expect(params).toHaveLength(5); // id, w1, cpu, ts, inc — SEM ts duplicado
  });

  it("chave que não casa com nenhum unique declarado → erro claro", () => {
    expect(() => compileAccumulate(metric, { workerId: "w1" }, { sampleCount: inc(1) })).toThrow(
      /needs a unique key on \[workerId\]/,
    );
  });

  it("chave de UMA coluna com .unique() é aceita (árbitro do ON CONFLICT)", () => {
    const daily = defineEntity("daily", {
      day: text().notNull().unique(),
      hits: int4().notNull().default(0),
    });
    const { text: sql } = compileAccumulate(daily, { day: "2026-01-01" }, { hits: inc(1) });
    expect(sql).toContain("ON CONFLICT (day) DO UPDATE SET");
    expect(sql).toContain("hits = daily.hits + excluded.hits");
  });

  it("chave por reference N:1 resolve pra <campo>_id", () => {
    const worker = defineEntity("worker", { label: text().notNull() });
    const perWorker = defineEntity(
      "per_worker",
      {
        worker: reference(worker),
        day: text().notNull(),
        hits: int4().notNull().default(0),
      },
      { unique: [["worker", "day"]] },
    );
    const { text: sql } = compileAccumulate(perWorker, { worker: "w-uuid", day: "2026-01-01" }, { hits: inc(1) });
    expect(sql).toContain("ON CONFLICT (worker_id, day) DO UPDATE SET");
    expect(sql).toMatch(/\(id, worker_id, day, hits\)/);
  });

  it("campo desconhecido na op → erro (barreira anti-injection)", () => {
    expect(() =>
      compileAccumulate(metric, { workerId: "w", name: "c", ts: new Date(0) }, { bogus: inc(1) }),
    ).toThrow(/unknown or non-column field 'bogus'/);
  });
});
