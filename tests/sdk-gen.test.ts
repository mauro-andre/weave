import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { irToSource, scopeToSource, genProject, pushScopes, defineScope, scopeRule, defineEntity, text } from "@mauroandre/weave-sdk";
import type { EntityIR } from "@mauroandre/weave-core";
import { runCli } from "@mauroandre/weave-sdk/cli";

// `weave gen`: estado do servidor (entidades + scopes) → pasta weave/ inteira.
// irToSource (IR → defineEntity, com/sem $id), scopeToSource (storage por-id →
// defineScope por-nome), genProject (orquestra: arquivos + barrels + client), e
// o `runCli(["gen"])` (wiring: env, clean, write).

describe("SDK codegen — irToSource", () => {
  const ir = {
    irVersion: 1,
    name: "product",
    fields: {
      name: { kind: "column", id: "fid-name", type: "text", notNull: true },
      price: { kind: "column", id: "fid-price", type: "int4" },
      tags: { kind: "column", id: "fid-tags", type: "text", array: true },
      category: { kind: "reference", id: "fid-cat", target: "category", cardinality: "one" },
      items: {
        kind: "owned",
        id: "fid-items",
        array: true,
        shape: { qty: { kind: "column", id: "fid-qty", type: "int4", notNull: true } },
      },
    },
  } as const;

  it("IR → source defineEntity (sem $id por padrão)", () => {
    const src = irToSource(ir as never);
    expect(src).toContain('export default defineEntity("product", {');
    expect(src).toContain("name: text().notNull(),");
    expect(src).toContain("price: int4(),");
    expect(src).toContain("tags: array(text()),");
    expect(src).toContain("category: reference(category),");
    expect(src).toContain("items: owned(array({ qty: int4().notNull() })),");
    expect(src).toContain('import category from "./category.js";');
    expect(src).toContain("import { defineEntity, array, int4, owned, reference, text } from");
    expect(src).not.toContain(".$id(");
  });

  it("withId: emite .$id(...) em cada campo (inclusive aninhados)", () => {
    const src = irToSource(ir as never, { withId: true });
    expect(src).toContain('name: text().notNull().$id("fid-name"),');
    expect(src).toContain('tags: array(text()).$id("fid-tags"),');
    expect(src).toContain('category: reference(category).$id("fid-cat"),');
    expect(src).toContain('owned(array({ qty: int4().notNull().$id("fid-qty") })).$id("fid-items")');
  });

  it("mirror: gera owned(array(mirror(Base, { extras }))) + importa a base + sem aviso", () => {
    const ir = {
      irVersion: 1,
      name: "orders",
      fields: {
        items: {
          kind: "owned",
          array: true,
          mirror: "products",
          shape: { quantity: { kind: "column", type: "int4", notNull: true } },
        },
      },
    } as const;
    const src = irToSource(ir as never);
    expect(src).toContain("owned(array(mirror(products, { quantity: int4().notNull() })))");
    expect(src).toContain('import products from "./products.js"'); // a base pelo nome lógico
    expect(src).not.toMatch(/write\/edit the shape by hand/); // aviso antigo sumiu
    const importLine = src.split("\n").find((l) => l.startsWith("import {"))!;
    for (const b of ["owned", "array", "mirror"]) expect(importLine).toContain(b);
  });

  it("mirror 1:1 puro (sem extras) → owned(mirror(Base))", () => {
    const ir = { irVersion: 1, name: "snap", fields: { p: { kind: "owned", array: false, mirror: "products" } } } as const;
    const src = irToSource(ir as never);
    expect(src).toContain("owned(mirror(products))");
  });

  it("partitionBy/retention → emite timeBucket no 3º arg + importa timeBucket", () => {
    const ir = {
      irVersion: 1,
      name: "appRequest",
      fields: {
        host: { kind: "column", type: "text", notNull: true },
        ts: { kind: "column", type: "timestamptz", notNull: true },
      },
      partitionBy: { field: "ts", interval: "1d" },
      retention: "30d",
    } as const;
    const src = irToSource(ir as never);
    expect(src).toContain('partitionBy: timeBucket("ts", "1d")');
    expect(src).toContain('retention: "30d"');
    const importLine = src.split("\n").find((l) => l.startsWith("import {"))!;
    expect(importLine).toContain("timeBucket"); // senão o arquivo gerado quebra
  });

  it("importa `array` quando SÓ um owned(array({…})) usa (sem scalar-array pra mascarar)", () => {
    const ownedArrayIr = {
      irVersion: 1,
      name: "dbPresets",
      fields: {
        presets: { kind: "owned", array: true, shape: { label: { kind: "column", type: "text", notNull: true } } },
      },
    } as const;
    const src = irToSource(ownedArrayIr as never);
    expect(src).toContain("owned(array({");
    // o import PRECISA ter `array` — senão o arquivo gerado quebra com ReferenceError.
    const importLine = src.split("\n").find((l) => l.startsWith("import {"))!;
    expect(importLine).toContain("array");
    expect(importLine).toContain("owned");
  });
});

describe("SDK codegen — scopeToSource", () => {
  const byName = new Map<string, EntityIR>([
    [
      "product",
      {
        irVersion: 1,
        name: "product",
        fields: {
          title: { kind: "column", id: "f1", type: "text", notNull: true },
          secret: { kind: "column", id: "f2", type: "text" },
          category: { kind: "reference", id: "f3", target: "category", cardinality: "one" },
        },
      },
    ],
    [
      "category",
      { irVersion: 1, name: "category", fields: { label: { kind: "column", id: "c1", type: "text" } } },
    ],
  ]);

  it("storage por-id → defineScope por-nome (where + projeção)", () => {
    const scope = {
      name: "public",
      entities: {
        product: {
          verbs: ["read"],
          rows: { path: ["f1"], op: "contains", value: "a" },
          fields: { mode: "exclude" as const, paths: [["f2"]] },
        },
      },
    };
    const src = scopeToSource(scope, byName);
    expect(src).toContain('export default defineScope("public", [');
    expect(src).toContain("scopeRule(product, {"); // regra amarrada à entity por referência
    expect(src).toContain('import product from "../entities/product.js";'); // + o import da entity
    expect(src).toContain('verbs: ["read"]');
    expect(src).toContain('title: {'); // where resolvido por nome
    expect(src).toContain('ilike: "%a%"'); // contains → ilike %..%
    expect(src).toContain('exclude: ["secret"]'); // projeção id→nome
  });

  it("resolve caminho aninhado via reference e param", () => {
    const scope = {
      name: "scoped",
      entities: {
        product: {
          verbs: ["read", "update"],
          rows: { path: ["f3", "c1"], op: "equals", value: { param: "label" } },
          fields: null,
        },
      },
    };
    const src = scopeToSource(scope, byName);
    expect(src).toContain('verbs: ["read", "update"]');
    expect(src).toContain("category: {");
    expect(src).toContain("label: {");
    expect(src).toContain('eq: {'); // valor é { param: "label" }
    expect(src).toContain('param: "label"');
  });

  it("resolve coluna de sistema (@id) e FK-shorthand (ref como folha)", () => {
    const scope = {
      name: "sys",
      entities: {
        product: {
          verbs: ["read"] as string[],
          rows: {
            and: [
              { path: ["@id"], op: "equals", value: { param: "pid" } }, // sentinel de sistema
              { path: ["f3"], op: "equals", value: { param: "cat" } }, // category (ref) como FOLHA → FK
            ],
          },
          fields: null,
        },
      },
    };
    const src = scopeToSource(scope, byName);
    expect(src).toContain("id: {"); // @id → id (coluna de sistema)
    expect(src).toContain("categoryId: {"); // ref na folha → FK-shorthand direto
  });
});

describe("SDK codegen — genProject / weave gen", () => {
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

    // empurra um scope-as-code (exercita o round-trip por-id → por-nome no gen)
    await pushScopes(
      {
        staff: defineScope("genstaff", [
          scopeRule(defineEntity("genprod", { name: text(), category: text() }), {
            verbs: ["read"],
            where: { name: { ilike: "%a%" } },
            fields: { exclude: ["category"] },
          }),
        ]),
      },
      { url: "http://localhost", key, fetch: (r) => app.hono.fetch(r) },
    );
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("genProject: entidades com $id, barrels, scope resolvido e client", async () => {
    const { files } = await genProject({ url: "http://localhost", key, fetch: (r) => app.hono.fetch(r) });

    // entidades com $id (rename-safe)
    expect(files["entities/genprod.ts"]).toContain("category: reference(gencat)");
    expect(files["entities/genprod.ts"]).toContain(".$id(");
    expect(files["entities/genprod.ts"]).toContain('import gencat from "./gencat.js";');
    expect(files["entities/gencat.ts"]).toContain("name: text().notNull().$id(");

    // barrel das entidades (re-export nomeado → autocomplete)
    expect(files["entities/index.ts"]).toContain('export { default as genprod } from "./genprod.js";');
    expect(files["entities/index.ts"]).toContain('export { default as gencat } from "./gencat.js";');

    // scope resolvido de volta: regra por referência à entity + import
    expect(files["scopes/genstaff.ts"]).toContain('export default defineScope("genstaff", [');
    expect(files["scopes/genstaff.ts"]).toContain("scopeRule(genprod,");
    expect(files["scopes/genstaff.ts"]).toContain('import genprod from "../entities/genprod.js";');
    expect(files["scopes/genstaff.ts"]).toContain("name: {");
    expect(files["scopes/genstaff.ts"]).toContain('ilike: "%a%"');
    expect(files["scopes/genstaff.ts"]).toContain('exclude: ["category"]');
    expect(files["scopes/index.ts"]).toContain('export { default as genstaff } from "./genstaff.js";');

    // client configurado, lê do ambiente
    expect(files["index.ts"]).toContain("createClient({");
    expect(files["index.ts"]).toContain("process.env.WEAVE_URL");
    expect(files["index.ts"]).toContain('import * as entities from "./entities/index.js";');
  });

  it("runCli gen: limpa as pastas e escreve a árvore na pasta do config", async () => {
    const config = { dir: "app/weave" };
    const load = async (p: string) => (p.endsWith("weave.config.ts") ? { default: config } : {});
    const written: Record<string, string> = {};
    const cleaned: string[] = [];
    const code = await runCli(["gen"], {
      load,
      fetch: (r) => app.hono.fetch(r),
      env: { WEAVE_URL: "http://localhost", WEAVE_KEY: key },
      write: async (file, content) => {
        written[file] = content;
      },
      clean: async (d) => {
        cleaned.push(d);
      },
      cwd: "/proj",
      log: () => {},
    });
    expect(code).toBe(0);
    expect(cleaned).toContain("/proj/app/weave/entities");
    expect(cleaned).toContain("/proj/app/weave/scopes");
    expect(written["/proj/app/weave/entities/genprod.ts"]).toContain(".$id(");
    expect(written["/proj/app/weave/index.ts"]).toContain("createClient({");
    expect(written["/proj/app/weave/scopes/genstaff.ts"]).toContain('defineScope("genstaff"');
  });
});
