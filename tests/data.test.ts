import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_saveEntity } from "../app/pages/Entities.js";
import { action_listObjects, action_saveObject } from "../app/pages/Data.js";

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
        await sql`DROP TABLE IF EXISTS blog__tags, blog, artigo, categoria, medida, ord, usr__addresses, usr, prod CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('blog', 'categoria', 'artigo', 'medida', 'usr', 'ord', 'prod')`;
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
    const filter = async (name: string, f: unknown): Promise<Page> => {
      const res = await app.as({ user: master }).action(action_listObjects, { body: { name, filter: f } });
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
      const p = await filter("ord", { path: ["buyer", "addresses", "city"], op: "contains", value: "paulo" });
      expect(p.docsQuantity).toBe(1);
      expect(p.docs[0]?.code).toBe("O1");
    });

    it("reference N:1 direta (buyer.name)", async () => {
      const p = await filter("ord", { path: ["buyer", "name"], op: "contains", value: "ali" });
      expect(p.docs.map((d) => d.code)).toEqual(["O1"]);
    });

    it("owned direto (addresses.city)", async () => {
      const p = await filter("usr", { path: ["addresses", "city"], op: "contains", value: "rio" });
      expect(p.docs.map((d) => d.name)).toEqual(["Alice"]);
    });

    it("coluna-array de texto: algum elemento contains", async () => {
      const p = await filter("prod", { path: ["tags"], op: "contains", value: "maç" });
      expect(p.docs.map((d) => d.name)).toEqual(["X"]);
    });

    it("coluna-array de número: algum elemento >= 5", async () => {
      const p = await filter("prod", { path: ["scores"], op: "gte", value: "5" });
      expect(p.docs.map((d) => d.name)).toEqual(["X"]);
    });

    it("escalar de topo (equals)", async () => {
      const p = await filter("ord", { path: ["code"], op: "equals", value: "O2" });
      expect(p.docs.map((d) => d.code)).toEqual(["O2"]);
    });

    it("AND combina condições (match all)", async () => {
      const p = await filter("ord", {
        and: [
          { path: ["buyer", "name"], op: "contains", value: "ali" },
          { path: ["code"], op: "equals", value: "O1" },
        ],
      });
      expect(p.docs.map((d) => d.code)).toEqual(["O1"]);
    });

    it("AND sem interseção retorna vazio", async () => {
      const p = await filter("ord", {
        and: [
          { path: ["buyer", "name"], op: "contains", value: "ali" },
          { path: ["code"], op: "equals", value: "O2" },
        ],
      });
      expect(p.docsQuantity).toBe(0);
    });

    it("OR une condições (match any)", async () => {
      const p = await filter("ord", {
        or: [
          { path: ["code"], op: "equals", value: "O1" },
          { path: ["code"], op: "equals", value: "O2" },
        ],
      });
      expect(p.docs.map((d) => d.code).sort()).toEqual(["O1", "O2"]);
    });

    it("árvore complexa: (b AND O2) OR O1", async () => {
      const p = await filter("ord", {
        or: [
          {
            and: [
              { path: ["buyer", "name"], op: "contains", value: "bob" },
              { path: ["code"], op: "equals", value: "O2" },
            ],
          },
          { path: ["code"], op: "equals", value: "O1" },
        ],
      });
      expect(p.docs.map((d) => d.code).sort()).toEqual(["O1", "O2"]);
    });

    it("SSR: filtro na URL renderiza só o resultado (refresh-safe)", async () => {
      const f = encodeURIComponent(
        JSON.stringify({ path: ["buyer", "addresses", "city"], op: "contains", value: "paulo" }),
      );
      const res = await app.as({ user: master }).get(`/data?entity=ord&filter=${f}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("O1");
      expect(html).not.toContain("O2");
    });
  });
});
