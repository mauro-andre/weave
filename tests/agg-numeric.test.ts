import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import {
  createClient,
  defineEntity,
  text,
  int4,
  int8,
  numeric,
  float8,
  timestamptz,
  count,
  sum,
  avg,
  min,
  max,
  distinct,
  first,
  percentile,
  div,
} from "@mauroandre/weave-sdk";

// A saída do `aggregate` é NUMÉRICA, igual à do `findMany`.
//
// O read passa por json aggregation no Postgres (que normaliza numeric/int8 → number) e
// pelo rehydrate; o aggregate lê coluna CRUA do driver, onde bigint/numeric chegam como
// STRING. Resultado: a MESMA coluna voltava number no findMany e string no aggregate, e
// `count() + 1` dava "11" em vez de 2 — sem erro de tipo, sem exceção. Aqui o contrato é:
// acumulador numérico volta `number`; o que NÃO é numérico (min/max/first de text/date)
// segue intocado.

const s = defineEntity("aggnum", {
  tag: text().notNull(),
  i4: int4(),
  i8: int8(),
  num: numeric(),
  f8: float8(),
  label: text(),
  at: timestamptz(),
});

describe("aggregate — saída numérica (paridade com o findMany)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const entities = { aggnum: s };
  const base = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const god = () => createClient(base());

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS aggnum CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'aggnum'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "aggnum",
          fields: {
            tag: { kind: "column", type: "text", notNull: true },
            i4: { kind: "column", type: "int4" },
            i8: { kind: "column", type: "int8" },
            num: { kind: "column", type: "numeric" },
            f8: { kind: "column", type: "float8" },
            label: { kind: "column", type: "text" },
            at: { kind: "column", type: "timestamptz" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "an" } });
    key = (await res.json()).key as string;
    await god().aggnum.createMany([
      { tag: "a", i4: 10, i8: 20, num: "1.5" as never, f8: 2.5, label: "zzz", at: new Date("2026-01-01") },
      { tag: "a", i4: 30, i8: 40, num: "2.5" as never, f8: 3.5, label: "aaa", at: new Date("2026-01-02") },
    ]);
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  const agg = async (select: Record<string, unknown>) =>
    ((await god().aggnum.aggregate({ groupBy: ["tag"], select } as never)) as unknown as Record<string, unknown>[])[0]!;

  it("count/distinct → number", async () => {
    const r = await agg({ n: count(), d: distinct("i4") });
    expect(typeof r.n).toBe("number");
    expect(r.n).toBe(2);
    expect(typeof r.d).toBe("number");
    // o reflexo do modelo: somar direto
    expect((r.n as number) + 1).toBe(3); // e não "21"
  });

  it("sum → number, em toda coluna numérica (int4/int8/numeric/float8)", async () => {
    const r = await agg({ s4: sum("i4"), s8: sum("i8"), sn: sum("num"), sf: sum("f8") });
    expect(typeof r.s4).toBe("number");
    expect(r.s4).toBe(40);
    expect(typeof r.s8).toBe("number");
    expect(r.s8).toBe(60);
    expect(typeof r.sn).toBe("number");
    expect(r.sn).toBe(4);
    expect(typeof r.sf).toBe("number");
    expect(r.sf).toBe(6);
  });

  it("avg/percentile → number", async () => {
    const r = await agg({ a: avg("i4"), p: percentile("i4", 0.5) });
    expect(typeof r.a).toBe("number");
    expect(r.a).toBe(20);
    expect(typeof r.p).toBe("number");
  });

  it("min/max de coluna numérica → number (inclusive numeric)", async () => {
    const r = await agg({ mi: min("i4"), ma: max("i4"), mn: max("num"), m8: max("i8") });
    expect(typeof r.mi).toBe("number");
    expect(r.mi).toBe(10);
    expect(typeof r.ma).toBe("number");
    expect(r.ma).toBe(30);
    expect(typeof r.mn).toBe("number"); // ← a MESMA coluna que o findMany devolve number
    expect(r.mn).toBe(2.5);
    expect(typeof r.m8).toBe("number");
    expect(r.m8).toBe(40);
  });

  it("expressão (div) → number", async () => {
    const r = await agg({ n: count(), s: sum("i4"), media: div("s", "n") });
    expect(typeof r.media).toBe("number");
    expect(r.media).toBe(20);
  });

  it("min/max/first de coluna NÃO numérica seguem intocados (text/date)", async () => {
    const r = await agg({ ml: min("label"), fl: first("label"), ma: max("at") });
    expect(typeof r.ml).toBe("string"); // text continua text
    expect(r.ml).toBe("aaa");
    expect(typeof r.fl).toBe("string");
    expect(r.ma).toBeTruthy(); // timestamptz não vira número
    expect(typeof r.ma).not.toBe("number");
  });

  it("paridade com o findMany: mesma coluna, mesmo tipo dos dois lados", async () => {
    const read = (await god().aggnum.findMany())[0] as Record<string, unknown>;
    const r = await agg({ mn: max("num"), m8: max("i8"), m4: max("i4") });
    expect(typeof r.mn).toBe(typeof read.num);
    expect(typeof r.m8).toBe(typeof read.i8);
    expect(typeof r.m4).toBe(typeof read.i4);
  });
});
