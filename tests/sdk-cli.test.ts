import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient } from "@mauroandre/weave-sdk";
import { parseArgs, runCli, discoverEntities } from "@mauroandre/weave-sdk/cli";
import category from "./fixtures/cli/entities/category.js";
import product from "./fixtures/cli/entities/product.js";
import staff from "./fixtures/cli/scopes/staff.js";

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
    expect(a.confirmAll).toBe(false);
  });

  it("parseArgs: --confirm all liga confirmAll (e ainda aceita granular junto)", () => {
    expect(parseArgs(["push", "--confirm", "all"]).confirmAll).toBe(true);
    const a = parseArgs(["push", "--confirm", "all", "--confirm", "todo.legacy"]);
    expect(a.confirmAll).toBe(true);
    expect(a.confirm).toEqual({ todo: ["legacy"] });
    expect(parseArgs(["push"]).confirmAll).toBe(false);
  });

  it("discoverEntities: lê a pasta e chaveia pelo nome da entidade (default export)", async () => {
    const load = async (p: string) =>
      p.endsWith("category.ts") ? { default: category } : { default: product };
    const entities = await discoverEntities(entitiesDir, load);
    expect(Object.keys(entities).sort()).toEqual(["clicat", "cliprod"]);
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

  const load = async (p: string) => {
    if (p.endsWith("weave.config.ts")) return { default: { dir: "." } }; // <cwd>/entities|scopes
    if (p.endsWith("category.ts")) return { default: category };
    if (p.endsWith("product.ts")) return { default: product };
    if (p.endsWith("staff.ts")) return { default: staff };
    return {};
  };

  it("weave push: empurra entidades + scopes (ordem de dep) e re-sincroniza via gen", async () => {
    const logs: string[] = [];
    const written: Record<string, string> = {};
    const cleaned: string[] = [];
    const code = await runCli(["push"], {
      load,
      fetch: (r) => app.hono.fetch(r),
      env: { WEAVE_URL: "http://localhost", WEAVE_KEY: key },
      cwd: fixturesDir,
      write: async (f, c) => {
        written[f] = c;
      },
      clean: async (d) => {
        cleaned.push(d);
      },
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("clicat");
    expect(out).toContain("cliprod");
    expect(out).toContain("1 scope"); // o scope foi empurrado

    // o gen rodou no fim: limpou as pastas e reescreveu com $id
    expect(cleaned).toContain(path.join(fixturesDir, "entities"));
    expect(written[path.join(fixturesDir, "entities/cliprod.ts")]).toContain(".$id(");
    expect(written[path.join(fixturesDir, "scopes/clistaff.ts")]).toContain('defineScope("clistaff"');

    // De fato funcional: criar via SDK (a reference resolve).
    const weave = createClient({
      url: "http://localhost",
      key,
      fetch: (r) => app.hono.fetch(r),
      entities: { clicat: category, cliprod: product },
    });
    const cat = await weave.clicat.create({ name: "Books" });
    const p = await weave.cliprod.create({ name: "Clean Code", price: 80, categoryId: cat.id });
    expect(p.categoryId).toBe(cat.id);
  });

  it("weave push --no-gen: aplica no server mas NÃO toca nos arquivos locais", async () => {
    const written: string[] = [];
    const cleaned: string[] = [];
    const code = await runCli(["push", "--no-gen"], {
      load,
      fetch: (r) => app.hono.fetch(r),
      env: { WEAVE_URL: "http://localhost", WEAVE_KEY: key },
      cwd: fixturesDir,
      write: async (f) => {
        written.push(f);
      },
      clean: async (d) => {
        cleaned.push(d);
      },
      log: () => {},
    });
    expect(code).toBe(0);
    expect(written).toEqual([]); // gen pulado
    expect(cleaned).toEqual([]);
  });
});
