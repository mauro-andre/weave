import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, bool, float8, reference, owned, array, count, avg, first } from "@mauroandre/weave-sdk";

// Perfil MCP (stats coletivos): agregar sobre owned aninhado. Dois pedidos:
//  - Pedido 2: groupBy/acumulador por dot-path (reference→escalar, owned-1:1→escalar).
//  - Pedido 1: `unnest` de um owned-array → agrega sobre os ELEMENTOS (como $unwind),
//    band = count(FILTER campo-do-elemento = const), first = representante do grupo.
// Prova os VALORES end-to-end: o `where` filtra os PAIS antes do fan-out; o FILTER
// filtra os ELEMENTOS; e os JOINs de path batem com os nomes de tabela/FK do DDL.

const uresp = defineEntity("agguresp", { name: text().notNull(), departmentSlug: text() });
const upaths = defineEntity("aggupaths", {
  isFinalized: bool(),
  respondent: reference(uresp),
  managerResult: owned({
    fitScore: float8(),
    anchors: owned(array({ name: text().notNull(), score: float8(), alignment: text(), note: text() })),
  }),
});

describe("aggregate sobre owned aninhado — dot-path (Pedido 2) + unnest (Pedido 1)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const weave = () =>
    createClient({ url: "http://localhost", key, entities: { agguresp: uresp, aggupaths: upaths }, fetch: (r) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql.unsafe(`DO $$ DECLARE r RECORD; BEGIN
          FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'aggupaths%' OR tablename = 'agguresp') LOOP
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP; END $$;`);
        await sql`DELETE FROM weave_entities WHERE name IN ('aggupaths', 'agguresp')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "agguresp",
          fields: {
            name: { kind: "column", type: "text", notNull: true },
            departmentSlug: { kind: "column", type: "text" },
          },
        });
        await applyEntity({
          irVersion: 1,
          name: "aggupaths",
          fields: {
            isFinalized: { kind: "column", type: "bool" },
            respondent: { kind: "reference", target: "agguresp", cardinality: "one" },
            managerResult: {
              kind: "owned",
              array: false,
              shape: {
                fitScore: { kind: "column", type: "float8" },
                anchors: {
                  kind: "owned",
                  array: true,
                  shape: {
                    name: { kind: "column", type: "text", notNull: true },
                    score: { kind: "column", type: "float8" },
                    alignment: { kind: "column", type: "text" },
                    note: { kind: "column", type: "text" },
                  },
                },
              },
            },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "agg-unnest key" } });
    key = (await res.json()).key as string;

    const ada = await weave().agguresp.create({ name: "Ada", departmentSlug: "ti" });
    const bob = await weave().agguresp.create({ name: "Bob", departmentSlug: "rh" });
    // P1, P2 (Ada, finalizados). P3 (Bob, NÃO finalizado) — excluído pelo where do pai.
    await weave().aggupaths.create({
      isFinalized: true,
      respondentId: ada.id,
      managerResult: {
        fitScore: 0.9,
        anchors: [
          { name: "autonomy", score: 8, alignment: "high", note: "N-auto" },
          { name: "security", score: 5, alignment: "low", note: "N-sec" },
        ],
      },
    });
    await weave().aggupaths.create({
      isFinalized: true,
      respondentId: ada.id,
      managerResult: {
        fitScore: 0.7,
        anchors: [
          { name: "autonomy", score: 6, alignment: "high", note: "N-auto" },
          { name: "security", score: 4, alignment: "partial", note: "N-sec" },
        ],
      },
    });
    await weave().aggupaths.create({
      isFinalized: false,
      respondentId: bob.id,
      managerResult: { fitScore: 0.2, anchors: [{ name: "autonomy", score: 1, alignment: "low", note: "N-auto" }] },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("Pedido 1 — unnest anchors: band por âncora sobre os finalizados (o where filtra os PAIS)", async () => {
    const rows = (await weave().aggupaths.aggregate({
      where: { isFinalized: true },
      unnest: "managerResult.anchors",
      groupBy: ["managerResult.anchors.name"],
      select: {
        n: count(),
        avgScore: avg("managerResult.anchors.score"),
        high: count({ where: { "managerResult.anchors.alignment": { eq: "high" } } }),
        low: count({ where: { "managerResult.anchors.alignment": { eq: "low" } } }),
        note: first("managerResult.anchors.note"),
      },
      orderBy: { "managerResult.anchors.name": "asc" },
    })) as Record<string, unknown>[];

    expect(rows).toHaveLength(2); // autonomy, security — Bob (não finalizado) fora
    const autonomy = rows[0]!;
    const security = rows[1]!;

    // autonomy: P1(8,high) + P2(6,high) → n=2, avg=7, high=2, low=0
    expect(autonomy["managerResult.anchors.name"]).toBe("autonomy");
    expect(Number(autonomy.n)).toBe(2);
    expect(Number(autonomy.avgScore)).toBeCloseTo(7, 5);
    expect(Number(autonomy.high)).toBe(2);
    expect(Number(autonomy.low)).toBe(0);
    expect(autonomy.note).toBe("N-auto"); // representante constante do grupo

    // security: P1(5,low) + P2(4,partial) → n=2, avg=4.5, high=0, low=1
    expect(security["managerResult.anchors.name"]).toBe("security");
    expect(Number(security.n)).toBe(2);
    expect(Number(security.avgScore)).toBeCloseTo(4.5, 5);
    expect(Number(security.high)).toBe(0);
    expect(Number(security.low)).toBe(1);
    expect(security.note).toBe("N-sec");
  });

  it("Pedido 2 — groupBy por reference→escalar + avg por owned-1:1 (sem fan-out, conta os pais)", async () => {
    const rows = (await weave().aggupaths.aggregate({
      groupBy: ["respondent.departmentSlug"],
      select: { n: count(), avgFit: avg("managerResult.fitScore") },
      orderBy: { "respondent.departmentSlug": "asc" },
    })) as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    const rh = rows.find((r) => r["respondent.departmentSlug"] === "rh")!;
    const ti = rows.find((r) => r["respondent.departmentSlug"] === "ti")!;
    // ti = Ada (P1, P2): n=2, avgFit=(0.9+0.7)/2=0.8 · rh = Bob (P3): n=1, avgFit=0.2
    expect(Number(ti.n)).toBe(2);
    expect(Number(ti.avgFit)).toBeCloseTo(0.8, 5);
    expect(Number(rh.n)).toBe(1);
    expect(Number(rh.avgFit)).toBeCloseTo(0.2, 5);
  });
});
