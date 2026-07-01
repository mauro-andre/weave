import { describe, it, expect } from "vitest";
import {
  compileAggregate,
  count,
  sum,
  distinct,
  percentile,
  histogram,
  timeBucket,
  defineEntity,
  text,
  int4,
  timestamptz,
} from "../../app/engine/index.js";

// Esqueleto do compilador de agregação (count/sum + groupBy + orderBy). SQL puro,
// sem DB. Inclui os guards de identificador (barreira anti-injection).

const req = defineEntity("appreq", {
  host: text().notNull(),
  route: text().notNull(),
  durationMs: int4(),
  status: int4(),
  ts: timestamptz(),
});

const sqlOf = (input: Parameters<typeof compileAggregate<typeof req>>[1]) => compileAggregate(req, input);

describe("compileAggregate — count/sum + groupBy + orderBy", () => {
  it("count + groupBy campo + orderBy por alias", () => {
    const { text: sql } = sqlOf({ groupBy: ["route"], select: { total: count() }, orderBy: { total: "desc" } });
    expect(sql).toContain(`SELECT appreq.route AS "route", count(*) AS "total"`);
    expect(sql).toContain("GROUP BY appreq.route");
    expect(sql).toContain(`ORDER BY "total" DESC`);
  });

  it("sum de coluna camelCase → coluna snake", () => {
    const { text: sql } = sqlOf({ groupBy: ["route"], select: { dur: sum("durationMs") } });
    expect(sql).toContain(`sum(appreq.duration_ms) AS "dur"`);
  });

  it("timeBucket 5min (epoch-floor UTC) — a query de aceitação", () => {
    const { text: sql, params } = sqlOf({
      where: { host: "x", ts: { gte: new Date("2020-01-01T00:00:00Z") } },
      groupBy: { ts: timeBucket("ts", "5min") },
      select: { requests: count() },
      orderBy: { ts: "asc" },
    });
    const bucket = `to_timestamp(floor(extract(epoch from appreq.ts) / 300) * 300)`;
    expect(sql).toContain(`${bucket} AS "ts"`);
    expect(sql).toContain(`GROUP BY ${bucket}`);
    expect(sql).toContain(`ORDER BY "ts" ASC`);
    expect(sql).toContain("WHERE"); // where reusado do compileWhere
    expect(params[0]).toBe("x");
  });

  it("agregação do conjunto inteiro (sem groupBy)", () => {
    const { text: sql } = sqlOf({ select: { total: count() } });
    expect(sql).toContain(`count(*) AS "total"`);
    expect(sql).not.toContain("GROUP BY");
  });

  it("distinct → count(distinct col)", () => {
    const { text: sql } = sqlOf({ groupBy: ["route"], select: { hosts: distinct("host") } });
    expect(sql).toContain(`count(distinct appreq.host) AS "hosts"`);
  });

  it("percentile → percentile_cont WITHIN GROUP, p bindado", () => {
    const { text: sql, params } = sqlOf({ groupBy: ["route"], select: { p95: percentile("durationMs", 0.95) } });
    expect(sql).toMatch(/percentile_cont\(\$1\) WITHIN GROUP \(ORDER BY appreq\.duration_ms\) AS "p95"/);
    expect(params[0]).toBe(0.95);
  });

  it("guard: percentile p fora de (0,1) → erro", () => {
    expect(() => sqlOf({ select: { p: percentile("durationMs", 95) } })).toThrow(/fraction between 0 and 1/);
  });

  it("acumulador com { where } → FILTER (WHERE …), params na ordem do SELECT", () => {
    const { text: sql, params } = sqlOf({
      groupBy: ["route"],
      select: {
        total: count(),
        errors: count({ where: { status: { gte: 500 } } }),
      },
    });
    expect(sql).toContain(`count(*) AS "total"`);
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE appreq\.status >= \$1\) AS "errors"/);
    expect(params[0]).toBe(500);
  });

  it("histogram → N fronteiras viram N+1 baldes (< b0 · [b0,b1) · >= b1), bindadas", () => {
    const { text: sql, params } = sqlOf({ groupBy: ["route"], select: { bars: histogram("durationMs", [100, 300]) } });
    const col = "appreq.duration_ms";
    expect(sql).toContain(
      `array[count(*) FILTER (WHERE ${col} < $1), ` +
        `count(*) FILTER (WHERE ${col} >= $1 AND ${col} < $2), ` +
        `count(*) FILTER (WHERE ${col} >= $2)] AS "bars"`,
    );
    expect(params).toEqual([100, 300]);
  });

  it("histogram com { where } → AND-ado em cada balde", () => {
    const { text: sql, params } = sqlOf({
      select: { bars: histogram("durationMs", [100], { where: { status: 200 } }) },
    });
    const col = "appreq.duration_ms";
    expect(sql).toContain(
      `array[count(*) FILTER (WHERE ${col} < $1 AND (appreq.status = $2)), ` +
        `count(*) FILTER (WHERE ${col} >= $1 AND (appreq.status = $2))]`,
    );
    expect(params).toEqual([100, 200]);
  });

  it("guard: histogram sem fronteiras → erro", () => {
    expect(() => sqlOf({ select: { h: histogram("durationMs", []) } })).toThrow(/at least one boundary/);
  });

  it("guard: histogram com fronteiras não-crescentes → erro", () => {
    expect(() => sqlOf({ select: { h: histogram("durationMs", [300, 100]) } })).toThrow(/strictly ascending/);
  });

  it("having → HAVING sobre a expressão do acumulador (não o alias)", () => {
    const { text: sql, params } = sqlOf({
      groupBy: ["route"],
      select: { n: count() },
      having: { n: { gte: 100 } },
      orderBy: { n: "desc" },
    });
    expect(sql).toContain(`HAVING count(*) >= $1`);
    expect(sql).toContain(`ORDER BY "n" DESC`);
    expect(params[0]).toBe(100);
  });

  it("having shorthand (valor cru → =)", () => {
    const { text: sql, params } = sqlOf({ groupBy: ["route"], select: { n: count() }, having: { n: 1 } });
    expect(sql).toContain(`HAVING count(*) = $1`);
    expect(params[0]).toBe(1);
  });

  it("guard: having sobre alias inexistente → erro", () => {
    expect(() => sqlOf({ groupBy: ["route"], select: { n: count() }, having: { nope: 1 } })).toThrow(
      /unknown select alias/,
    );
  });

  it("página → LIMIT/OFFSET (top-N)", () => {
    const { text: sql } = sqlOf({ groupBy: ["route"], select: { n: count() }, orderBy: { n: "desc" }, page: 2, perPage: 10 });
    expect(sql).toContain("LIMIT 10 OFFSET 10");
  });

  it("ordem dos params: FILTER (SELECT) antes de WHERE antes de HAVING", () => {
    const { params } = sqlOf({
      where: { host: "h" },
      groupBy: ["route"],
      select: { errors: count({ where: { status: { gte: 500 } } }) },
      having: { errors: { gte: 3 } },
    });
    // FILTER 500 (no SELECT) → host "h" (WHERE) → having 3 (HAVING).
    expect(params).toEqual([500, "h", 3]);
  });

  it("guard: campo desconhecido no acumulador → erro", () => {
    expect(() => sqlOf({ select: { x: sum("nope") } })).toThrow(/unknown field/);
  });

  it("guard: alias inválido → erro (anti-injection)", () => {
    expect(() => sqlOf({ select: { ['a"; DROP TABLE x; --']: count() } })).toThrow(/invalid aggregate alias/);
  });

  it("guard: intervalo de timeBucket inválido → erro", () => {
    expect(() => sqlOf({ groupBy: { t: timeBucket("ts", "5weeks") }, select: { n: count() } })).toThrow(
      /invalid timeBucket/,
    );
  });
});
