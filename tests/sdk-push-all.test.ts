import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import path from "node:path";
import { fileURLToPath } from "node:url";
import routes from "../app/routes.js";
import { pushAll } from "@mauroandre/weave-sdk/cli";
import category from "./fixtures/cli/entities/category.js";
import product from "./fixtures/cli/entities/product.js";
import staff from "./fixtures/cli/scopes/staff.js";

// pushAll (Node): descobre entities + scopes da pasta, empurra via POST /admin/push
// (o applyProject, que persiste pending), depois scopes se convergir. É o que o boot
// chama. Reusa as fixtures do CLI (clicat/cliprod/clistaff).

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/cli");
const load = async (p: string) => {
  if (p.endsWith("category.ts")) return { default: category };
  if (p.endsWith("product.ts")) return { default: product };
  if (p.endsWith("staff.ts")) return { default: staff };
  return {};
};

describe("pushAll — push de projeto (entities + scopes)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

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
        await sql`DELETE FROM weave_scopes WHERE name = 'clistaff'`;
        await sql`DELETE FROM weave_pending`;
      },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("descobre, topo-ordena, empurra entities e scopes, devolve estruturado", async () => {
    const r = await pushAll({
      url: "http://localhost",
      key: process.env.WEAVE_API_KEY!, // god-key de env
      dir: fixturesDir,
      load,
      fetch: (req) => app.hono.fetch(req),
    });

    expect(r.review).toEqual([]); // aditivo → converge
    expect(r.applied).toContain("clicat");
    expect(r.applied).toContain("cliprod");
    // dep order: a referida (clicat) antes da que referencia (cliprod)
    expect(r.applied.indexOf("clicat")).toBeLessThan(r.applied.indexOf("cliprod"));
    expect(r.scopes).toContain("clistaff"); // scopes só depois de convergir

    // convergiu → pending vazio
    const { getPending } = await import("../app/engine/control-plane/pending.js");
    expect(await getPending()).toBeNull();
  });

  it("re-push idempotente: mesmo código → nada a fazer, sem review", async () => {
    const r = await pushAll({
      url: "http://localhost",
      key: process.env.WEAVE_API_KEY!,
      dir: fixturesDir,
      load,
      fetch: (req) => app.hono.fetch(req),
    });
    expect(r.review).toEqual([]);
    // applied ainda lista as entities (aplicar um diff vazio = "applied", idempotente)
    expect(r.applied).toContain("cliprod");
  });
});
