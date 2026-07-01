import { describe, it, expect } from "vitest";
import { compileAggregate, count, sum, timeBucket, defineEntity, text, int4, timestamptz } from "../../app/engine/index.js";

// Esqueleto do compilador de agregação (count/sum + groupBy + orderBy). SQL puro,
// sem DB. Inclui os guards de identificador (barreira anti-injection).

const req = defineEntity("appreq", {
  host: text().notNull(),
  route: text().notNull(),
  durationMs: int4(),
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
