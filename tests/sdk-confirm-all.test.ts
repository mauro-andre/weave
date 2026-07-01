import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { defineEntity, text } from "@mauroandre/weave-sdk";
import { runCli } from "@mauroandre/weave-sdk/cli";

// `weave push --confirm all`: aceita TODAS as remoções (🔴 confirm) de uma vez, sem
// listar `entity.field` uma por uma. E combina com `--fill` (🟡 needsValue) num mesmo
// comando — o `all` cobre os removes, o `--fill` dá o valor do backfill.

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/confirmall");

// v1: opt opcional + 2 campos descartáveis. v2: opt obrigatório, dropA/dropB removidos.
const v1 = defineEntity("cathing", { keep: text().notNull(), opt: text(), dropA: text(), dropB: text() });
const v2 = defineEntity("cathing", { keep: text().notNull(), opt: text().notNull() });

describe("SDK CLI — weave push --confirm all (+ --fill)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  let current: typeof v1 | typeof v2 = v1;
  let logs: string[] = [];

  const load = async (p: string) =>
    p.endsWith("weave.config.ts")
      ? { default: { dir: "." } }
      : p.endsWith("thing.ts")
        ? { default: current }
        : {};

  const push = (argv: string[]) =>
    runCli(argv, {
      load,
      fetch: (r) => app.hono.fetch(r),
      env: { WEAVE_URL: "http://localhost", WEAVE_KEY: key },
      cwd: fixturesDir,
      write: async () => {},
      clean: async () => {},
      log: (m) => logs.push(m),
    });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS cathing CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'cathing'`;
        await sql`DELETE FROM weave_api_keys`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "cathing key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("remove 2 + torna 1 obrigatório; `--confirm all --fill` aplica tudo num comando", async () => {
    // v1 cria; uma linha com opt=null pra o makeRequired virar needsValue de verdade.
    current = v1;
    logs = [];
    expect(await push(["push", "--no-gen"])).toBe(0);
    const { saveObject } = await import("../app/engine/control-plane/data.js");
    await saveObject("cathing", { keep: "row1" });

    // v2 sem flags → review (exit 1): 2 removes + 1 makeRequired.
    current = v2;
    logs = [];
    expect(await push(["push", "--no-gen"])).toBe(1);
    const review = logs.join("\n");
    expect(review).toContain("removeField  cathing.dropA");
    expect(review).toContain("removeField  cathing.dropB");
    expect(review).toContain("makeRequired  cathing.opt");

    // --confirm all (cobre os 2 removes) + --fill (o valor do obrigatório) → aplica tudo.
    logs = [];
    expect(await push(["push", "--no-gen", "--confirm", "all", "--fill", "cathing.opt=filled"])).toBe(0);

    const { db } = await import("../app/engine/control-plane/db.js");
    const cols = (
      await db()<{ column_name: string; is_nullable: string }[]>`
        SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'cathing'`
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("keep");
    expect(names).toContain("opt");
    expect(names).not.toContain("drop_a");
    expect(names).not.toContain("drop_b");
    expect(cols.find((c) => c.column_name === "opt")?.is_nullable).toBe("NO"); // virou obrigatório

    // a linha existente recebeu o backfill do --fill.
    const row = (await db()<{ opt: string }[]>`SELECT opt FROM cathing LIMIT 1`)[0];
    expect(row?.opt).toBe("filled");
  });
});
