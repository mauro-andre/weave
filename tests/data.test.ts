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
        await sql`DROP TABLE IF EXISTS blog__tags, blog, artigo, categoria, medida CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('blog', 'categoria', 'artigo')`;
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
});
