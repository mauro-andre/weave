import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_saveEntity } from "../app/pages/Entities.js";
import { action_listObjects, action_saveObject, action_deleteObject } from "../app/pages/Data.js";

describe("data browser — leitura de objetos", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let master: { id: string };

  const save = (name: string, fields: Record<string, unknown>) =>
    app.as({ user: master }).action(action_saveEntity, { body: { ir: { irVersion: 1, name, fields } } });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS blog__tags, blog, artigo, categoria, medida, ord, usr__addresses, usr, prod, book CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('blog', 'categoria', 'artigo', 'medida', 'usr', 'ord', 'prod', 'book')`;
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

  it("lista objetos com owned aninhado", async () => {
    await save("blog", {
      titulo: { kind: "column", type: "text" },
      tags: { kind: "owned", array: true, shape: { nome: { kind: "column", type: "text" } } },
    });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const [b] = await sql<{ id: string }[]>`INSERT INTO blog (titulo) VALUES ('Hello') RETURNING id`;
    await sql`INSERT INTO blog__tags (blog_id, nome) VALUES (${b!.id}, 'a'), (${b!.id}, 'b')`;

    const res = await app.as({ user: master }).action(action_listObjects, { body: { name: "blog" } });
    const page = (await res.json()) as {
      docs: { titulo: string; tags: { nome: string }[] }[];
      docsQuantity: number;
    };
    expect(page.docsQuantity).toBe(1);
    expect(page.docs[0]?.titulo).toBe("Hello");
    expect(page.docs[0]?.tags.map((t) => t.nome).sort()).toEqual(["a", "b"]);
  });

  it("expande a reference (mostra os dados do alvo)", async () => {
    await save("categoria", { nome: { kind: "column", type: "text" } });
    await save("artigo", {
      titulo: { kind: "column", type: "text" },
      categoria: { kind: "reference", target: "categoria", cardinality: "one" },
    });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const [c] = await sql<{ id: string }[]>`INSERT INTO categoria (nome) VALUES ('Tech') RETURNING id`;
    await sql`INSERT INTO artigo (titulo, categoria_id) VALUES ('Post', ${c!.id})`;

    const res = await app.as({ user: master }).action(action_listObjects, { body: { name: "artigo" } });
    const page = (await res.json()) as { docs: { titulo: string; categoria: { nome: string } }[] };
    expect(page.docs[0]?.titulo).toBe("Post");
    expect(page.docs[0]?.categoria?.nome).toBe("Tech"); // dados do alvo expandidos
  });

  // ── escrita ───────────────────────────────────────────────────────────────
  const blogDocs = async () => {
    const res = await app.as({ user: master }).action(action_listObjects, { body: { name: "blog" } });
    return (await res.json()).docs as { id: string; titulo: string; tags: { nome: string }[] }[];
  };

  it("cria um objeto novo (escalares + owned)", async () => {
    const res = await app.as({ user: master }).action(action_saveObject, {
      body: { name: "blog", object: { titulo: "New", tags: [{ nome: "x" }, { nome: "y" }] } },
    });
    expect((await res.json()).ok).toBe(true);

    const created = (await blogDocs()).find((d) => d.titulo === "New");
    expect(created).toBeTruthy();
    expect(created!.tags.map((t) => t.nome).sort()).toEqual(["x", "y"]);
  });

  it("edita um objeto: atualiza escalar e SUBSTITUI o owned", async () => {
    const hello = (await blogDocs()).find((d) => d.titulo === "Hello")!;
    const res = await app.as({ user: master }).action(action_saveObject, {
      body: { name: "blog", object: { id: hello.id, titulo: "Hello!", tags: [{ nome: "z" }] } },
    });
    expect((await res.json()).ok).toBe(true);

    const updated = (await blogDocs()).find((d) => d.id === hello.id)!;
    expect(updated.titulo).toBe("Hello!");
    expect(updated.tags.map((t) => t.nome)).toEqual(["z"]); // a, b foram substituídos
  });

  it("preserva a reference (read-only) ao editar um escalar", async () => {
    const before = await app.as({ user: master }).action(action_listObjects, { body: { name: "artigo" } });
    const art = (await before.json()).docs[0] as { id: string; categoria: { id: string; nome: string } };

    // Edita só o título, devolvendo a categoria expandida (como a GUI faz).
    await app.as({ user: master }).action(action_saveObject, {
      body: { name: "artigo", object: { id: art.id, titulo: "Post!", categoria: art.categoria } },
    });

    const after = await app.as({ user: master }).action(action_listObjects, { body: { name: "artigo" } });
    const updated = (await after.json()).docs[0] as { titulo: string; categoria: { nome: string } };
    expect(updated.titulo).toBe("Post!");
    expect(updated.categoria?.nome).toBe("Tech"); // FK preservada, não foi zerada
  });

  it("cria objeto novo com reference informando o id", async () => {
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    const [c] = await sql<{ id: string }[]>`SELECT id FROM categoria WHERE nome = 'Tech'`;

    // Simula o que a GUI manda: a reference como { id } (o _id digitado).
    await app.as({ user: master }).action(action_saveObject, {
      body: { name: "artigo", object: { titulo: "Linked", categoria: { id: c!.id } } },
    });

    const res = await app.as({ user: master }).action(action_listObjects, { body: { name: "artigo" } });
    const linked = (await res.json()).docs.find(
      (d: { titulo: string }) => d.titulo === "Linked",
    ) as { categoria: { nome: string } };
    expect(linked.categoria?.nome).toBe("Tech"); // vínculo criado a partir do id
  });

  it("SSR: /data?entity=blog renderiza os objetos (estado na URL)", async () => {
    const res = await app.as({ user: master }).get("/data?entity=blog");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Hello"); // título de um objeto seedado
  });

  it("SSR: /data sem entity não auto-seleciona nada", async () => {
    const res = await app.as({ user: master }).get("/data");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Select an entity"); // estado vazio
  });

  it("serializa colunas int8 (BigInt) sem quebrar", async () => {
    await save("medida", { peso: { kind: "column", type: "int8" } });
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    await sql`INSERT INTO medida (peso) VALUES (42)`;

    // Sem o jsonSafe, o res.json() (JSON.stringify) estouraria no BigInt.
    const res = await app.as({ user: master }).action(action_listObjects, { body: { name: "medida" } });
    const page = (await res.json()) as { docs: { peso: number }[] };
    expect(page.docs[0]?.peso).toBe(42);
  });

  // ── Filtro por caminho aninhado (o diferencial) ─────────────────────────────
  describe("filtro por caminho aninhado", () => {
    type Page = { docs: { code?: string; name?: string }[]; docsQuantity: number };
    const save = (name: string, object: Record<string, unknown>) =>
      app.as({ user: master }).action(action_saveObject, { body: { name, object } });
    const filter = async (name: string, w: unknown): Promise<Page> => {
      const res = await app.as({ user: master }).action(action_listObjects, { body: { name, where: w } });
      return (await res.json()) as Page;
    };

    beforeAll(async () => {
      const define = (ir: unknown) => app.as({ user: master }).action(action_saveEntity, { body: { ir } });
      await define({
        irVersion: 1,
        name: "usr",
        fields: {
          name: { kind: "column", type: "text" },
          addresses: { kind: "owned", array: true, shape: { city: { kind: "column", type: "text" } } },
        },
      });
      await define({
        irVersion: 1,
        name: "ord",
        fields: {
          code: { kind: "column", type: "text" },
          buyer: { kind: "reference", target: "usr", cardinality: "one" },
        },
      });
      await define({
        irVersion: 1,
        name: "prod",
        fields: {
          name: { kind: "column", type: "text" },
          tags: { kind: "column", type: "text", array: true },
          scores: { kind: "column", type: "int4", array: true },
        },
      });

      const alice = ((await (await save("usr", { name: "Alice", addresses: [{ city: "São Paulo" }, { city: "Rio" }] })).json()) as { object: { id: string } }).object.id;
      const bob = ((await (await save("usr", { name: "Bob", addresses: [{ city: "Belo Horizonte" }] })).json()) as { object: { id: string } }).object.id;
      await save("ord", { code: "O1", buyer: { id: alice } });
      await save("ord", { code: "O2", buyer: { id: bob } });
      await save("prod", { name: "X", tags: ["maçã", "banana"], scores: [3, 7] });
      await save("prod", { name: "Y", tags: ["uva"], scores: [1, 2] });
    });

    it("🚩 orders cujo user tem ALGUM address com city ~ (ref → owned → texto)", async () => {
      const p = await filter("ord", { buyer: { addresses: { some: { city: { ilike: "%paulo%" } } } } });
      expect(p.docsQuantity).toBe(1);
      expect(p.docs[0]?.code).toBe("O1");
    });

    it("reference N:1 direta (buyer.name)", async () => {
      const p = await filter("ord", { buyer: { name: { ilike: "%ali%" } } });
      expect(p.docs.map((d) => d.code)).toEqual(["O1"]);
    });

    it("owned direto (addresses.city)", async () => {
      const p = await filter("usr", { addresses: { some: { city: { ilike: "%rio%" } } } });
      expect(p.docs.map((d) => d.name)).toEqual(["Alice"]);
    });

    it("coluna-array de texto: algum elemento contains", async () => {
      const p = await filter("prod", { tags: { some: { ilike: "%maç%" } } });
      expect(p.docs.map((d) => d.name)).toEqual(["X"]);
    });

    it("coluna-array de número: algum elemento >= 5", async () => {
      const p = await filter("prod", { scores: { some: { gte: 5 } } });
      expect(p.docs.map((d) => d.name)).toEqual(["X"]);
    });

    it("escalar de topo (equals)", async () => {
      const p = await filter("ord", { code: { eq: "O2" } });
      expect(p.docs.map((d) => d.code)).toEqual(["O2"]);
    });

    it("AND combina condições (match all)", async () => {
      const p = await filter("ord", {
        and: [
          { buyer: { name: { ilike: "%ali%" } } },
          { code: { eq: "O1" } },
        ],
      });
      expect(p.docs.map((d) => d.code)).toEqual(["O1"]);
    });

    it("AND sem interseção retorna vazio", async () => {
      const p = await filter("ord", {
        and: [
          { buyer: { name: { ilike: "%ali%" } } },
          { code: { eq: "O2" } },
        ],
      });
      expect(p.docsQuantity).toBe(0);
    });

    it("OR une condições (match any)", async () => {
      const p = await filter("ord", {
        or: [
          { code: { eq: "O1" } },
          { code: { eq: "O2" } },
        ],
      });
      expect(p.docs.map((d) => d.code).sort()).toEqual(["O1", "O2"]);
    });

    it("árvore complexa: (b AND O2) OR O1", async () => {
      const p = await filter("ord", {
        or: [
          {
            and: [
              { buyer: { name: { ilike: "%bob%" } } },
              { code: { eq: "O2" } },
            ],
          },
          { code: { eq: "O1" } },
        ],
      });
      expect(p.docs.map((d) => d.code).sort()).toEqual(["O1", "O2"]);
    });

    it("filtra por campo gerenciado (id equals)", async () => {
      const res = await app.as({ user: master }).action(action_listObjects, { body: { name: "ord" } });
      const docs = (await res.json()).docs as { id: string; code: string }[];
      const o1 = docs.find((d) => d.code === "O1")!;
      const p = await filter("ord", { id: { eq: o1.id } });
      expect(p.docs.map((d) => d.code)).toEqual(["O1"]);
    });

    it("SSR: filtro na URL renderiza só o resultado (refresh-safe)", async () => {
      const f = encodeURIComponent(
        JSON.stringify({ buyer: { addresses: { some: { city: { ilike: "%paulo%" } } } } }),
      );
      const res = await app.as({ user: master }).get(`/data?entity=ord&where=${f}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("O1");
      expect(html).not.toContain("O2");
    });
  });

  // ── Ordenação ───────────────────────────────────────────────────────────────
  describe("ordenação", () => {
    type Page = { docs: { code?: string; title?: string; year?: number }[] };
    const sortBy = async (name: string, s: unknown): Promise<Page> => {
      const res = await app.as({ user: master }).action(action_listObjects, { body: { name, orderBy: s } });
      return (await res.json()) as Page;
    };

    beforeAll(async () => {
      // `ord`/`usr` já existem (do bloco de filtro). Cria `book` p/ multi-chave.
      await app.as({ user: master }).action(action_saveEntity, {
        body: {
          ir: {
            irVersion: 1,
            name: "book",
            fields: { title: { kind: "column", type: "text" }, year: { kind: "column", type: "int4" } },
          },
        },
      });
      const save = (object: Record<string, unknown>) =>
        app.as({ user: master }).action(action_saveObject, { body: { name: "book", object } });
      await save({ title: "Beta", year: 2000 });
      await save({ title: "Alpha", year: 2010 });
      await save({ title: "Alpha", year: 1990 });
    });

    it("ordena por escalar de topo (desc)", async () => {
      const p = await sortBy("ord", { code: "desc" });
      expect(p.docs.map((d) => d.code)).toEqual(["O2", "O1"]);
    });

    it("ordena por caminho aninhado N:1 (buyer.name asc)", async () => {
      const p = await sortBy("ord", { buyer: { name: "asc" } });
      expect(p.docs.map((d) => d.code)).toEqual(["O1", "O2"]); // Alice < Bob
    });

    it("múltiplas chaves (title asc, year asc)", async () => {
      const p = await sortBy("book", { title: "asc", year: "asc" });
      expect(p.docs.map((d) => d.year)).toEqual([1990, 2010, 2000]); // Alpha 1990, Alpha 2010, Beta 2000
    });

    it("ordena por campo gerenciado (created at)", async () => {
      const p = await sortBy("book", { createdAt: "asc" });
      expect(p.docs.map((d) => d.title)).toEqual(["Beta", "Alpha", "Alpha"]); // ordem de criação
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  describe("delete", () => {
    const newId = async (name: string, object: Record<string, unknown>): Promise<string> => {
      const res = await app.as({ user: master }).action(action_saveObject, { body: { name, object } });
      return ((await res.json()) as { object: { id: string } }).object.id;
    };

    it("deleta um objeto", async () => {
      const id = await newId("book", { title: "ToDelete", year: 1 });
      const res = await app.as({ user: master }).action(action_deleteObject, { body: { name: "book", id } });
      expect((await res.json()).ok).toBe(true);

      const list = await app.as({ user: master }).action(action_listObjects, { body: { name: "book" } });
      const ids = ((await list.json()).docs as { id: string }[]).map((d) => d.id);
      expect(ids).not.toContain(id);
    });

    it("bloqueia delete de objeto referenciado (mensagem amigável)", async () => {
      const carol = await newId("usr", { name: "Carol" });
      await newId("ord", { code: "DEL-REF", buyer: { id: carol } });
      const res = await app.as({ user: master }).action(action_deleteObject, { body: { name: "usr", id: carol } });
      expect((await res.json()).error).toMatch(/referenced/i);
    });
  });
});
