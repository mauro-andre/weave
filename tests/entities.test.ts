import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_saveEntity } from "../app/pages/Entities.js";

const productsIR = {
  irVersion: 1,
  name: "products",
  fields: {
    title: { kind: "column", type: "text", notNull: true },
    price: { kind: "column", type: "int4" },
    variants: {
      kind: "owned",
      array: true,
      shape: {
        sku: { kind: "column", type: "text", notNull: true },
      },
    },
  },
};

describe("entidades — criar e materializar", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let master: { id: string };

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup(); // garante weave_users (+ master) e weave_entities
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS product__variants, products, produtos_especiais CASCADE`;
        await sql`DELETE FROM weave_entities`;
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

  it("salva o IR e materializa as tabelas (products + product__variants)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, { body: { ir: productsIR } });
    expect(await res.json()).toMatchObject({ ok: true, name: "products" });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();

    const [row] = await sql<{ name: string }[]>`SELECT name FROM weave_entities WHERE name = 'products'`;
    expect(row?.name).toBe("products");

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('products', 'product__variants')
      ORDER BY table_name
    `;
    expect(tables.map((t) => t.table_name)).toEqual(["product__variants", "products"]);
  });

  it("a tela de nova entidade renderiza (SSR)", async () => {
    const res = await app.as({ user: master }).get("/entities/new");
    expect(res.status).toBe(200);
  });

  it("a tela de edição carrega uma entidade existente (SSR)", async () => {
    // `products` foi criada no primeiro teste (mesma suíte, em ordem).
    const res = await app.as({ user: master }).get("/entities/products");
    expect(res.status).toBe(200);
  });

  it("normaliza nomes de entidade e campos (acentos/espaços/maiúsculas)", async () => {
    const ir = {
      irVersion: 1,
      name: "Produtos Especiais",
      fields: { "Descrição": { kind: "column", type: "text" } },
    };
    const res = await app.as({ user: master }).action(action_saveEntity, { body: { ir } });
    expect(await res.json()).toMatchObject({ ok: true, name: "produtos_especiais" });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'produtos_especiais'
    `;
    expect(cols.map((c) => c.column_name)).toContain("descricao");
  });

  it("rejeita IR inválido (tipo fora do catálogo)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: { ir: { irVersion: 1, name: "bad", fields: { x: { kind: "column", type: "naoexiste" } } } },
    });
    expect((await res.json()).error).toBeTruthy();
  });
});
