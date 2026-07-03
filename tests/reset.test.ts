import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { createClient, defineEntity, text, timestamptz, timeBucket } from "@mauroandre/weave-sdk";
import { toIR } from "@mauroandre/weave-core";

// Factory reset (dev/test only). Trava por env WEAVE_DEV_MODE: sem ela, 403 e nada
// acontece; com ela, wipe total → push reconstrói o schema do zero. É o substituto
// do "dropar todas as coleções do Mongo". Autentica com a god-key de ENV (WEAVE_API_KEY),
// que sobrevive ao wipe (não é linha de tabela).
const plain = defineEntity("resetPlain", { name: text().notNull() });
const part = defineEntity(
  "resetPart",
  { host: text().notNull(), ts: timestamptz().notNull() },
  { partitionBy: timeBucket("ts", "1d"), retention: "30d" },
);
const entities = { resetPlain: plain, resetPart: part };

describe("factory reset — trava por WEAVE_DEV_MODE + wipe/rebuild", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  const weave = () =>
    createClient({ url: "http://localhost", key: process.env.WEAVE_API_KEY!, entities, fetch: (r) => app.hono.fetch(r) });

  const q = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const { db } = await import("../app/engine/control-plane/db.js");
    return (await db().unsafe(sql, params as never[])) as Record<string, unknown>[];
  };
  const tableExists = async (t: string) =>
    (await q(`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1`, [t])).length > 0;
  const entityCount = async () => Number((await q(`SELECT count(*)::int AS n FROM weave_entities`))[0]!.n);
  const partitionsOf = async (parent: string) =>
    (
      await q(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid ` +
          `JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname=$1`,
        [parent],
      )
    ).length;

  const rebuild = async () => {
    const { applyEntity } = await import("../app/engine/control-plane/entities.js");
    await applyEntity(toIR(plain));
    await applyEntity(toIR(part));
  };

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS reset_plain, reset_part CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('reset_plain','reset_part')`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    await rebuild(); // schema inicial
    // Semeia dado (o partitioned cria a gaveta de hoje no create).
    await weave().resetPlain.create({ name: "keep-me" });
    await weave().resetPart.create({ host: "api", ts: new Date() });
    delete process.env.WEAVE_DEV_MODE; // garante estado inicial: reset DESLIGADO
  });

  afterAll(async () => {
    delete process.env.WEAVE_DEV_MODE;
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("WEAVE_DEV_MODE OFF → reset responde 403 e NÃO apaga nada", async () => {
    delete process.env.WEAVE_DEV_MODE;
    await expect(weave().reset()).rejects.toThrow(); // 403 → o client lança
    // dado intacto
    expect(await weave().resetPlain.findMany()).toHaveLength(1);
    expect(await entityCount()).toBeGreaterThanOrEqual(2);
    expect(await tableExists("reset_plain")).toBe(true);
  });

  it("WEAVE_DEV_MODE ON → reset zera tudo; push reconstrói; findMany=[]; partição renasce lazy", async () => {
    process.env.WEAVE_DEV_MODE = "true";

    await weave().reset(); // resolve (200)

    // Estado virgem: metastore vazio, tabelas de app sumiram.
    expect(await entityCount()).toBe(0);
    expect(await tableExists("reset_plain")).toBe(false);
    expect(await tableExists("reset_part")).toBe(false);

    // `weave push` reconstrói o schema do entities-as-code.
    await rebuild();
    expect(await tableExists("reset_part")).toBe(true);

    // Entidades existem de novo, porém vazias.
    expect(await weave().resetPlain.findMany()).toEqual([]);
    expect(await weave().resetPart.findMany()).toEqual([]);
    expect(await partitionsOf("reset_part")).toBe(0); // sem gaveta ainda (lazy)

    // Um create na entity particionada renasce a partição — prova que o push
    // reconstruiu partitionBy/retention e o cache in-memory foi zerado no reset.
    await weave().resetPart.create({ host: "api", ts: new Date() });
    expect(await partitionsOf("reset_part")).toBe(1);
  });
});
