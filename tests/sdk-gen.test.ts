import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { irToSource, genClientSource } from "@mauroandre/weave-sdk";
import { runCli } from "@mauroandre/weave-sdk/cli";

// F5: codegen. irToSource (IR → defineEntity), genClientSource (barrel), e
// `weave pull` (IRs remotos → arquivos de entidade) via runCli + write injetado.

describe("SDK codegen (F5) — irToSource / genClientSource", () => {
  it("irToSource: IR → source defineEntity (com imports e builders)", () => {
    const ir = {
      irVersion: 1,
      name: "product",
      fields: {
        name: { kind: "column", type: "text", notNull: true },
        price: { kind: "column", type: "int4" },
        tags: { kind: "column", type: "text", array: true },
        category: { kind: "reference", target: "category", cardinality: "one" },
        items: { kind: "owned", array: true, shape: { qty: { kind: "column", type: "int4", notNull: true } } },
      },
    } as const;
    const src = irToSource(ir as never);

    expect(src).toContain('export default defineEntity("product", {');
    expect(src).toContain("name: text().notNull(),");
    expect(src).toContain("price: int4(),");
    expect(src).toContain("tags: array(text()),");
    expect(src).toContain("category: reference(category),");
    expect(src).toContain("items: owned(array({ qty: int4().notNull() })),");
    expect(src).toContain('import category from "./category.js";');
    expect(src).toContain("import { defineEntity, array, int4, owned, reference, text } from");
  });

  it("genClientSource: barrel com imports + createClient", () => {
    const src = genClientSource(["category", "product"]);
    expect(src).toContain('import category from "../entities/category.js";');
    expect(src).toContain('import product from "../entities/product.js";');
    expect(src).toContain("export const entities = { category, product };");
    expect(src).toContain("createClient({ url: process.env.WEAVE_URL!");
  });
});

describe("SDK codegen (F5) — weave pull", () => {
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
        await sql`DROP TABLE IF EXISTS genprod, gencat CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('genprod','gencat')`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "gencat", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "genprod",
          fields: {
            name: { kind: "column", type: "text", notNull: true },
            category: { kind: "reference", target: "gencat", cardinality: "one" },
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
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "gen key" } });
    key = (await res.json()).key as string;
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("weave pull: IRs remotos → arquivos de entidade (codegen)", async () => {
    const config = { entities: "./entities", url: "http://localhost", key };
    const load = async (p: string) => (p.endsWith("weave.config.ts") ? { default: config } : {});
    const written: Record<string, string> = {};
    const code = await runCli(["pull"], {
      load,
      fetch: (r) => app.hono.fetch(r),
      write: async (file, content) => {
        written[file.split("/").pop()!] = content;
      },
      cwd: "/proj",
      log: () => {},
    });
    expect(code).toBe(0);
    // (o banco é compartilhado entre arquivos de teste — pull traz todas; checamos as nossas)
    expect(Object.keys(written)).toContain("gencat.ts");
    expect(Object.keys(written)).toContain("genprod.ts");
    expect(written["genprod.ts"]).toContain("category: reference(gencat),");
    expect(written["genprod.ts"]).toContain('import gencat from "./gencat.js";');
    expect(written["gencat.ts"]).toContain("name: text().notNull(),");
  });
});
