import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text, int4, jsonb, count } from "@mauroandre/weave-sdk";

// Operador DESCONHECIDO num filtro → erro alto, nunca predicado falso.
//
// `isOperatorMap` é tudo-ou-nada: um reflexo de Prisma/Mongo (`{ contains }`, ou
// `{ ilike, mode }`) não era reconhecido como mapa de operadores, caía no `eq` cru, e o
// driver stringificava o objeto → `col = '[object Object]'` → **zero linhas, sem erro**.
// Um operador VÁLIDO ao lado de um desconhecido morria junto. O `tsc` pega isso no `where`
// tipado, mas o slot `{ where }` do acumulador é `Record<string, unknown>` e a API HTTP é
// crua — é por lá que entra. Em json/jsonb um objeto é VALOR e continua valendo.

const w = defineEntity("wunk", { name: text().notNull(), status: int4(), meta: jsonb() });

describe("where — operador desconhecido estoura (não vira predicado falso)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const entities = { wunk: w };
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
        await sql`DROP TABLE IF EXISTS wunk CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'wunk'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "wunk",
          fields: {
            name: { kind: "column", type: "text", notNull: true },
            status: { kind: "column", type: "int4" },
            meta: { kind: "column", type: "jsonb" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "wu" } });
    key = (await res.json()).key as string;
    await god().wunk.create({ name: "api", status: 200, meta: { foo: 1 } as never });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("reflexo do Prisma no where → erro nomeando o operador", async () => {
    // Antes: 0 linhas, sem erro (`name = '[object Object]'`).
    await expect(god().wunk.findMany({ name: { contains: "api" } } as never)).rejects.toThrow(/unknown operator 'contains'/);
  });

  it("operador VÁLIDO ao lado de um desconhecido → erro (antes o válido era descartado)", async () => {
    await expect(god().wunk.findMany({ name: { ilike: "%api%", mode: "insensitive" } } as never)).rejects.toThrow(
      /unknown operator 'mode'/,
    );
  });

  it("o slot { where } do acumulador (sem tipagem) também estoura", async () => {
    await expect(
      god().wunk.aggregate({ select: { n: count({ where: { name: { contains: "api" } } }) } } as never),
    ).rejects.toThrow(/unknown operator 'contains'/);
  });

  it("json/jsonb: objeto é VALOR, continua filtrando", async () => {
    const r = await god().wunk.findMany({ meta: { foo: 1 } } as never);
    expect(r).toHaveLength(1);
  });

  it("os operadores de verdade seguem funcionando", async () => {
    expect(await god().wunk.findMany({ name: { ilike: "%pi%" } })).toHaveLength(1);
    expect(await god().wunk.findMany({ status: { gte: 200 } })).toHaveLength(1);
    expect(await god().wunk.findMany({ name: "api" })).toHaveLength(1); // valor cru = eq
    expect(await god().wunk.findMany({ meta: null } as never)).toHaveLength(0); // null = IS NULL
  });
});
