import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient } from "@mauroandre/weave-sdk";
import { parseArgs, runCli, discoverSchema } from "@mauroandre/weave-sdk/cli";
import category from "./fixtures/cli/entities/category.js";
import product from "./fixtures/cli/entities/product.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/cli");
const entitiesDir = path.join(fixturesDir, "entities");

describe("SDK CLI (F3) — parseArgs + weave push", () => {
  it("parseArgs: --confirm / --fill / --rename / --config", () => {
    const a = parseArgs([
      "push",
      "--config", "w.config.ts",
      "--confirm", "product.legacy",
      "--fill", "product.sku=N/A",
      "--rename", "product.name=title",
    ]);
    expect(a.command).toBe("push");
    expect(a.config).toBe("w.config.ts");
    expect(a.confirm).toEqual({ product: ["legacy"] });
    expect(a.fill).toEqual({ product: { sku: "N/A" } });
    expect(a.renames).toEqual({ product: { name: "title" } });
  });

  it("discoverSchema: lê a pasta e chaveia pelo nome da entidade (default export)", async () => {
    const load = async (p: string) =>
      p.endsWith("category.ts") ? { default: category } : { default: product };
    const schema = await discoverSchema(entitiesDir, load);
    expect(Object.keys(schema).sort()).toEqual(["clicat", "cliprod"]);
  });
});

describe("SDK CLI (F3) — weave push integração", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS cliprod, clicat CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('cliprod','clicat')`;
        await sql`DELETE FROM weave_api_keys`;
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "cli key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("weave push: descobre por pasta, aplica em ordem de dependência, e funciona", async () => {
    const config = { entities: "./entities", url: "http://localhost", key };
    const load = async (p: string) => {
      if (p.endsWith("weave.config.ts")) return { default: config };
      if (p.endsWith("category.ts")) return { default: category };
      if (p.endsWith("product.ts")) return { default: product };
      return {};
    };
    const logs: string[] = [];
    const code = await runCli(["push"], {
      load,
      fetch: (r) => app.hono.fetch(r),
      cwd: fixturesDir,
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("clicat");
    expect(out).toContain("cliprod");

    // De fato funcional: criar via SDK (a reference resolve).
    const weave = createClient({
      url: "http://localhost",
      key,
      fetch: (r) => app.hono.fetch(r),
      schema: { clicat: category, cliprod: product },
    });
    const cat = await weave.clicat.create({ name: "Books" });
    const p = await weave.cliprod.create({ name: "Clean Code", price: 80, categoryId: cat.id });
    expect(p.categoryId).toBe(cat.id);
  });
});
