import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_saveEntity } from "../app/pages/Entities.js";
import { action_saveObject } from "../app/pages/Data.js";
import { toIR, irToModel } from "../app/pages/EntityDesigner.js";

// Reproduz o FLUXO EXATO da GUI: salvar uma entity particionada pelo designer
// (action_saveEntity com o IR que o `toIR` produz) e inserir pelo data browser
// (action_saveObject). Confere que a tabela nasce particionada e que a partição
// aparece no 1º insert (lazy). É o caminho que o Mauro fez na tela.

describe("GUI → partição (fluxo do designer + data browser)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let master: { id: string };

  const partitions = async (): Promise<string[]> => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = (await db().unsafe(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid ` +
        `JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='time_test' ORDER BY name`,
    )) as unknown as { name: string }[];
    return rows.map((r) => r.name);
  };
  const partStrat = async (): Promise<string | undefined> => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const rows = (await db().unsafe(
      `SELECT partstrat FROM pg_partitioned_table pt JOIN pg_class c ON c.oid=pt.partrelid WHERE c.relname='time_test'`,
    )) as unknown as { partstrat: string }[];
    return rows[0]?.partstrat;
  };

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS time_test CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'time_test'`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  // O IR que o designer produz quando você liga a partição e escolhe o `ts`.
  const guiIr = () => {
    const model = irToModel({
      irVersion: 1,
      name: "timeTest",
      fields: {
        host: { kind: "column", id: "h", type: "text", notNull: true },
        ts: { kind: "column", id: "t", type: "timestamptz", notNull: true },
      },
    });
    model.partition = { enabled: true, fieldId: "t", interval: "1d", keepForever: false, retention: "30d" };
    return toIR(model);
  };

  it("o toIR do designer emite partitionBy + retention", () => {
    const ir = guiIr();
    expect(ir.partitionBy).toEqual({ field: "ts", interval: "1d" });
    expect(ir.retention).toBe("30d");
  });

  it("action_saveEntity cria a tabela PARTICIONADA (partstrat='r'), ainda sem partições", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, { body: { ir: guiIr() } });
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(await partStrat()).toBe("r"); // 'r' = RANGE → tabela particionada de fato
    expect(await partitions()).toHaveLength(0); // lazy: nada ainda, tabela vazia
  });

  it("inserir pelo data browser (action_saveObject) cria a partição do dia (lazy)", async () => {
    const res = await app.as({ user: master }).action(action_saveObject, {
      body: { name: "timeTest", object: { host: "api", ts: new Date().toISOString() } },
    });
    const body = await res.json();
    expect(body.error).toBeUndefined();
    const parts = await partitions();
    expect(parts.length).toBe(1); // a gaveta de hoje apareceu no 1º insert
    expect(parts[0]).toMatch(/^time_test_\d{4}_\d{2}_\d{2}$/);
  });

  it("inserir outro dia cria a segunda partição", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await app.as({ user: master }).action(action_saveObject, {
      body: { name: "timeTest", object: { host: "api", ts: yesterday } },
    });
    expect((await partitions()).length).toBe(2);
  });
});
