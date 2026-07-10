import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";

// e2e do clamp de identificadores (bug de 63 chars do Perfil MCP): uma entity de nome
// longo com owned aninhado 4 níveis. No nível 2/3 o ÍNDICE/CONSTRAINT estoura 63; no nível
// 4 a TABELA estoura. Prova que o push aplica (sem "already exists") e que os nomes
// clampados são CONSISTENTES entre DDL + write + read — se algum divergisse, o create ou
// o read aninhado quebraria.

describe("owned aninhado profundo sob nome longo — clamp de 63 chars end-to-end", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const KEY = () => ({ "x-api-key": key });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        // dropa toda a árvore paths_applied* (nomes clampados inclusos)
        await sql.unsafe(`DO $$ DECLARE r RECORD; BEGIN
          FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'paths_applied%' LOOP
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP; END $$;`);
        await sql`DELETE FROM weave_entities WHERE name = 'paths_applied'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        const col = (type: string, notNull = false) => ({ kind: "column" as const, type, ...(notNull ? { notNull: true } : {}) });
        await applyEntity({
          irVersion: 1,
          name: "pathsApplied",
          fields: {
            ratingAssessments: {
              kind: "owned",
              array: true,
              shape: {
                name: col("text", true),
                statements: {
                  kind: "owned",
                  array: true,
                  shape: {
                    statement: col("text", true),
                    criteria: {
                      kind: "owned",
                      array: true,
                      shape: {
                        threshold: col("int4"),
                        thresholds: { kind: "owned", array: true, shape: { value: col("int4") } }, // 4º nível → estoura a TABELA
                      },
                    },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "deep key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("a árvore de tabelas subiu (a do nível 4 clampou, sem colisão)", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = await db()<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname='public' and tablename like 'paths_applied%'`;
    // root + 4 níveis = 5 tabelas
    expect(rows.length).toBe(5);
    // a do nível 4 é a clampada: começa com o root e termina no leaf, no meio o hash
    const clamped = rows.map((r) => r.tablename).find((n) => n.includes("__thresholds") && !n.includes("__criteria__thresholds"));
    expect(clamped).toBeDefined();
    expect(clamped!.length).toBeLessThanOrEqual(63);
  });

  it("cria um objeto aninhado 4 níveis e lê de volta idêntico (nomes consistentes)", async () => {
    const body = {
      ratingAssessments: [
        {
          name: "A1",
          statements: [
            {
              statement: "s1",
              criteria: [{ threshold: 5, thresholds: [{ value: 10 }, { value: 20 }] }],
            },
          ],
        },
      ],
    };
    const post = await app.post("/api/paths_applied", { headers: KEY(), body });
    expect(post.status).toBe(201);
    const id = (await post.json()).id as string;

    const got = await (await app.get("/api/paths_applied", { headers: KEY(), query: { where: JSON.stringify({ id }) } })).json();
    const doc = got.docs[0];
    // o owned volta aninhado automaticamente — se qualquer nome de tabela/FK divergisse
    // entre DDL/write/read, algum destes seria undefined/vazio.
    const ra = doc.ratingAssessments[0];
    expect(ra.name).toBe("A1");
    const st = ra.statements[0];
    expect(st.statement).toBe("s1");
    const cr = st.criteria[0];
    expect(cr.threshold).toBe(5);
    expect(cr.thresholds.map((t: { value: number }) => t.value).sort((a: number, b: number) => a - b)).toEqual([10, 20]);
  });
});
