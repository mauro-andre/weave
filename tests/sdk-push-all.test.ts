import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { pushAll } from "@mauroandre/weave-sdk";
import category from "./fixtures/cli/entities/category.js";
import product from "./fixtures/cli/entities/product.js";
import staff from "./fixtures/cli/scopes/staff.js";

// pushAll (modo objeto): empurra entities + scopes JÁ EM MEMÓRIA via POST /admin/push
// (o applyProject, que persiste pending), depois scopes se convergir. É o que o app server
// chama no boot loop — sem discovery de disco. Fixtures clicat/cliprod/clistaff.

const entities = { category, product };
const scopes = { staff };

describe("pushAll — push de projeto (entities + scopes) em modo objeto", () => {
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

  it("empurra entities (topo-ordenadas) e scopes, devolve estruturado", async () => {
    const r = await pushAll({
      url: "http://localhost",
      key: process.env.WEAVE_API_KEY!, // god-key de env
      entities,
      scopes,
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

  it("re-push idempotente: mesmos objetos → nada a fazer, sem review", async () => {
    const r = await pushAll({
      url: "http://localhost",
      key: process.env.WEAVE_API_KEY!,
      entities,
      scopes,
      fetch: (req) => app.hono.fetch(req),
    });
    expect(r.review).toEqual([]);
    expect(r.applied).toContain("cliprod");
  });

  it("scopes ausente → pula o push de scopes (no-op)", async () => {
    const r = await pushAll({
      url: "http://localhost",
      key: process.env.WEAVE_API_KEY!,
      entities, // sem `scopes`
      fetch: (req) => app.hono.fetch(req),
    });
    expect(r.review).toEqual([]);
    expect(r.scopes).toEqual([]); // não tentou empurrar nenhum scope
  });
});
