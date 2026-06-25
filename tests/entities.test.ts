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
        await sql`DROP TABLE IF EXISTS product__variants, products, produtos_especiais, pedido__itens, pedido, produto, tarefa CASCADE`;
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

  it("owned espelhado (mirror) materializa com a forma da entidade base", async () => {
    await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "produto",
          fields: {
            nome: { kind: "column", type: "text", notNull: true },
            preco: { kind: "column", type: "int4" },
          },
        },
      },
    });
    await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "pedido",
          fields: { itens: { kind: "owned", array: true, mirror: "produto" } },
        },
      },
    });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pedido__itens'
    `;
    expect(cols.map((c) => c.column_name)).toEqual(expect.arrayContaining(["nome", "preco"]));
  });

  it("mirror + campos locais: espelha a base E acrescenta os extras (quantidade)", async () => {
    // `produto` já existe (criada no teste anterior, mesma suíte/ordem).
    await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "pedido",
          fields: {
            itens: {
              kind: "owned",
              array: true,
              mirror: "produto",
              shape: {
                quantidade: { kind: "column", type: "int4", notNull: true },
                subtotal: { kind: "column", type: "int4" },
              },
            },
          },
        },
      },
    });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pedido__itens'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toEqual(expect.arrayContaining(["nome", "preco", "quantidade", "subtotal"]));

    // O IR guardado preserva mirror + os campos locais (não a forma expandida).
    const { getEntity } = await import("../app/engine/control-plane/entities.js");
    const pedido = await getEntity("pedido");
    const itens = pedido?.fields.itens;
    expect(itens).toMatchObject({ kind: "owned", mirror: "produto" });
    expect(Object.keys((itens as { shape: object }).shape)).toEqual(["quantidade", "subtotal"]);
  });

  it("materializa valores default por tipo (text/int4/bool)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "tarefa",
          fields: {
            titulo: { kind: "column", type: "text", notNull: true },
            status: { kind: "column", type: "text", default: "pending" },
            prioridade: { kind: "column", type: "int4", default: 1 },
            ativo: { kind: "column", type: "bool", default: true },
          },
        },
      },
    });
    expect(await res.json()).toMatchObject({ ok: true, name: "tarefa" });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const cols = await sql<{ column_name: string; column_default: string | null }[]>`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tarefa'
    `;
    const defaults = Object.fromEntries(cols.map((c) => [c.column_name, c.column_default]));
    expect(defaults["status"]).toContain("'pending'");
    expect(defaults["prioridade"]).toBe("1");
    expect(defaults["ativo"]).toBe("true");
    expect(defaults["titulo"]).toBeNull(); // sem default declarado
  });

  it("rejeita IR inválido (tipo fora do catálogo)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: { ir: { irVersion: 1, name: "bad", fields: { x: { kind: "column", type: "naoexiste" } } } },
    });
    expect((await res.json()).error).toBeTruthy();
  });
});
