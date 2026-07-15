import { describe, it, expect } from "vitest";
import {
  compileAggregate,
  count,
  sum,
  avg,
  first,
  distinct,
  percentile,
  histogram,
  div,
  mul,
  timeBucket,
  defineEntity,
  text,
  int4,
  bool,
  float8,
  timestamptz,
  owned,
  array,
  reference,
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
    expect(sql).toContain(`SELECT appreq.route AS "route", (count(*))::float8 AS "total"`);
    expect(sql).toContain("GROUP BY appreq.route");
    expect(sql).toContain(`ORDER BY "total" DESC`);
  });

  it("sum de coluna camelCase → coluna snake", () => {
    const { text: sql } = sqlOf({ groupBy: ["route"], select: { dur: sum("durationMs") } });
    expect(sql).toContain(`(sum(appreq.duration_ms))::float8 AS "dur"`);
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
    expect(sql).toContain(`(count(*))::float8 AS "total"`);
    expect(sql).not.toContain("GROUP BY");
  });

  it("distinct → count(distinct col)", () => {
    const { text: sql } = sqlOf({ groupBy: ["route"], select: { hosts: distinct("host") } });
    expect(sql).toContain(`(count(distinct appreq.host))::float8 AS "hosts"`);
  });

  it("percentile → percentile_cont WITHIN GROUP, p bindado", () => {
    const { text: sql, params } = sqlOf({ groupBy: ["route"], select: { p95: percentile("durationMs", 0.95) } });
    expect(sql).toMatch(/\(percentile_cont\(\$1\) WITHIN GROUP \(ORDER BY appreq\.duration_ms\)\)::float8 AS "p95"/);
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
    expect(sql).toContain(`(count(*))::float8 AS "total"`);
    expect(sql).toMatch(/\(count\(\*\) FILTER \(WHERE appreq\.status >= \$1\)\)::float8 AS "errors"/);
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

  const RATE = `((count(*) FILTER (WHERE appreq.status >= $1))::numeric / nullif((count(*)), 0))`;

  it("expressão div('errors','total') → inlina os aliases + nullif + cast numeric", () => {
    const { text: sql, params } = sqlOf({
      groupBy: ["route"],
      select: {
        errors: count({ where: { status: { gte: 500 } } }),
        total: count(),
        errorRate: div("errors", "total"),
      },
      orderBy: { errorRate: "desc" },
    });
    expect(sql).toContain(`(${RATE})::float8 AS "errorRate"`);
    expect(sql).toContain(`ORDER BY "errorRate" DESC`); // orderBy por alias de saída (Postgres deixa)
    expect(params).toEqual([500]);
  });

  it("acumulador INLINE como operando: div(count({where}), count()) sem selecionar os dois", () => {
    const { text: sql, params } = sqlOf({
      groupBy: ["route"],
      select: { rate: div(count({ where: { status: { gte: 500 } } }), count()) },
    });
    expect(sql).toContain(`(${RATE})::float8 AS "rate"`);
    expect(params).toEqual([500]);
  });

  it("número como operando (bindado) + mul aninhado", () => {
    const { text: sql, params } = sqlOf({
      groupBy: ["route"],
      select: {
        errors: count({ where: { status: { gte: 500 } } }),
        total: count(),
        pct: mul(div("errors", "total"), 100),
      },
    });
    expect(sql).toContain(`(((${RATE}) * ($2)))::float8 AS "pct"`);
    expect(params).toEqual([500, 100]); // 500 (filter) → 100 (literal do mul)
  });

  it("having sobre alias de EXPRESSÃO → inlina a div no HAVING", () => {
    const { text: sql, params } = sqlOf({
      groupBy: ["route"],
      select: { errors: count({ where: { status: { gte: 500 } } }), total: count(), errorRate: div("errors", "total") },
      having: { errorRate: { gt: 0.1 } },
    });
    expect(sql).toContain(`HAVING ${RATE} > $2`);
    expect(params).toEqual([500, 0.1]);
  });

  it("guard: expressão referencia alias inexistente → erro", () => {
    expect(() => sqlOf({ groupBy: ["route"], select: { total: count(), r: div("nope", "total") } })).toThrow(
      /unknown select alias 'nope'/,
    );
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

// ── Path-based aggregate: dot-paths (Pedido 2) + unnest owned-array (Pedido 1) ──
// The aggregate resolves owned/reference dot-paths via JOINs, and `unnest` fans one
// owned list out to its elements. Pure SQL shape — the JOIN plan and the fan-out.
const aggdept = defineEntity("aggdept", { slug: text().notNull() });
const aggjob = defineEntity("aggjob", { title: text().notNull(), department: reference(aggdept) });
const aggresp2 = defineEntity("aggresp2", {
  name: text().notNull(),
  departmentSlug: text(),
  jobPosition: reference(aggjob),
});
const aggpaths = defineEntity("aggpaths", {
  isFinalized: bool(),
  respondent: reference(aggresp2),
  managerResult: owned({
    cargoFitFitScore: float8(),
    careerAnchorAnalysis: owned({
      anchors: owned(
        array({
          name: text().notNull(),
          anchorAverage: float8(),
          companyAverage: float8(),
          alignment: text(),
          managerDescription: text(),
        }),
      ),
    }),
  }),
});
const ANCHORS = "aggpaths__manager_result__career_anchor_analysis__anchors";
const pathsOf = (input: Parameters<typeof compileAggregate<typeof aggpaths>>[1]) => compileAggregate(aggpaths, input);

describe("compileAggregate — dot-paths (Pedido 2)", () => {
  it("groupBy por path reference→escalar → LEFT JOIN no alvo, agrupa pela coluna dele", () => {
    const { text: sql } = pathsOf({ groupBy: ["respondent.departmentSlug"], select: { n: count() } });
    expect(sql).toMatch(/LEFT JOIN aggresp2 (\w+) ON \1\.id = aggpaths\.respondent_id/);
    expect(sql).toMatch(/\w+\.department_slug AS "respondent\.departmentSlug"/);
    expect(sql).toMatch(/GROUP BY \w+\.department_slug/);
  });

  it("avg por path owned-1:1 → LEFT JOIN na tabela filha, coluna snake", () => {
    const { text: sql } = pathsOf({ select: { fit: avg("managerResult.cargoFitFitScore") } });
    expect(sql).toMatch(/LEFT JOIN aggpaths__manager_result (\w+) ON \1\.aggpaths_id = aggpaths\.id/);
    expect(sql).toMatch(/avg\(\w+\.cargo_fit_fit_score\)/);
  });

  it("groupBy por reference MULTI-HOP → JOINs encadeados, agrupa pela FK do alvo final", () => {
    const { text: sql } = pathsOf({ groupBy: ["respondent.jobPosition.department"], select: { n: count() } });
    expect(sql).toContain("LEFT JOIN aggresp2 ");
    expect(sql).toContain("LEFT JOIN aggjob ");
    expect(sql).toMatch(/GROUP BY \w+\.department_id/); // folha é reference → FK
  });

  it("prefixo compartilhado: dois campos do mesmo owned reusam UM join", () => {
    const { text: sql } = pathsOf({
      select: { a: avg("managerResult.cargoFitFitScore"), b: sum("managerResult.cargoFitFitScore") },
    });
    expect(sql.match(/JOIN aggpaths__manager_result /g)).toHaveLength(1); // dedup por prefixo
  });

  it("guard: agregar através de owned LIST sem unnest → erro", () => {
    expect(() =>
      pathsOf({ groupBy: ["managerResult.careerAnchorAnalysis.anchors.name"], select: { n: count() } }),
    ).toThrow(/is an owned list/);
  });
});

describe("compileAggregate — unnest owned-array (Pedido 1)", () => {
  const agg = () =>
    pathsOf({
      where: { isFinalized: true },
      unnest: "managerResult.careerAnchorAnalysis.anchors",
      groupBy: ["managerResult.careerAnchorAnalysis.anchors.name"],
      select: {
        anchorAvg: avg("managerResult.careerAnchorAnalysis.anchors.anchorAverage"),
        distHigh: count({ where: { "managerResult.careerAnchorAnalysis.anchors.alignment": { eq: "high" } } }),
        desc: first("managerResult.careerAnchorAnalysis.anchors.managerDescription"),
      },
    });

  it("a lista vira INNER JOIN (fan-out), os hops 1:1 intermediários são LEFT JOIN", () => {
    const { text: sql } = agg();
    expect(sql).toContain(`\nJOIN ${ANCHORS} `); // fan-out: bare JOIN
    expect(sql).not.toContain(`LEFT JOIN ${ANCHORS} `); // não é LEFT
    expect(sql).toContain("LEFT JOIN aggpaths__manager_result "); // 1:1 intermediário
  });

  it("groupBy/avg/FILTER/first resolvem contra a coluna do ELEMENTO", () => {
    const { text: sql, params } = agg();
    expect(sql).toMatch(/GROUP BY \w+\.name/);
    expect(sql).toMatch(/avg\(\w+\.anchor_average\)/);
    // band = count FILTER com condição DIRETA na coluna do elemento (field vs const), sem EXISTS
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE \w+\.alignment = \$\d\)/);
    expect(sql).not.toContain("EXISTS");
    // first = representante determinístico por created_at do elemento
    expect(sql).toMatch(/\(array_agg\(\w+\.manager_description ORDER BY \w+\.created_at\)\)\[1\]/);
    // where do pai continua no root (filtra os pais, não os elementos)
    expect(sql).toMatch(/WHERE aggpaths\.is_finalized/);
    expect(params).toContain("high");
  });

  it("guard: unnest de algo que não é lista → erro", () => {
    expect(() => pathsOf({ unnest: "managerResult", select: { n: count() } })).toThrow(/must be an owned list/);
  });
});
