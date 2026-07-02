import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_saveEntity, action_planEntity, action_deleteEntity } from "../app/pages/Entities.js";

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
        await sql`DROP TABLE IF EXISTS products__variants, products, produtos_especiais, pedido__itens, pedido, produto, tarefa, conta__enderecos, conta, cliente, ra, rb, rc, rd, re, rf, thing2__order, thing2, cuq, cureg, custack, delme, delme__items, backup_storages, db_presets__presets, db_presets, stacks, apps CASCADE`;
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

  it("salva o IR e materializa as tabelas (products + products__variants)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, { body: { ir: productsIR } });
    expect(await res.json()).toMatchObject({ ok: true, name: "products" });

    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();

    const [row] = await sql<{ name: string }[]>`SELECT name FROM weave_entities WHERE name = 'products'`;
    expect(row?.name).toBe("products");

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('products', 'products__variants')
      ORDER BY table_name
    `;
    expect(tables.map((t) => t.table_name)).toEqual(["products", "products__variants"]);
  });

  it("a tela de nova entidade renderiza com a seção Index (SSR)", async () => {
    const res = await app.as({ user: master }).get("/entities/new");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Index"); // a seção de composto renderiza
    expect(html).toContain("add index");
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
            nome: { kind: "column", type: "text", notNull: true, unique: true },
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

    // O snapshot NÃO herda `unique` da base (mesmo produto cabe em vários itens).
    const uniq = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'pedido__itens' AND constraint_type = 'UNIQUE'
    `;
    expect(uniq[0]?.n).toBe(0);
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

  it("garante um id estável em todo campo (recursivo no owned)", async () => {
    await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "conta",
          fields: {
            titular: { kind: "column", type: "text" },
            enderecos: {
              kind: "owned",
              array: true,
              shape: { cidade: { kind: "column", type: "text" } },
            },
          },
        },
      },
    });

    const { getEntity } = await import("../app/engine/control-plane/entities.js");
    const conta = (await getEntity("conta"))!;
    const enderecos = conta.fields.enderecos as { id?: string; shape: Record<string, { id?: string }> };
    expect(typeof conta.fields.titular?.id).toBe("string");
    expect(conta.fields.titular?.id).toBeTruthy();
    expect(enderecos.id).toBeTruthy();
    expect(enderecos.shape.cidade?.id).toBeTruthy();
  });

  it("mantém o id num re-save sem ids (fallback por nome)", async () => {
    const { getEntity } = await import("../app/engine/control-plane/entities.js");
    const titularId = (await getEntity("conta"))!.fields.titular?.id;

    // Cliente "burro" da API: re-salva a mesma forma sem mandar ids.
    await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "conta",
          fields: {
            titular: { kind: "column", type: "text" },
            enderecos: {
              kind: "owned",
              array: true,
              shape: { cidade: { kind: "column", type: "text" } },
            },
          },
        },
      },
    });

    expect((await getEntity("conta"))!.fields.titular?.id).toBe(titularId);
  });

  it("rename preserva o id (mesmo id, nome novo)", async () => {
    const { getEntity } = await import("../app/engine/control-plane/entities.js");
    const titularId = (await getEntity("conta"))!.fields.titular?.id;

    // A GUI renomeia `titular` → `dono` carregando o MESMO id.
    await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "conta",
          fields: {
            dono: { kind: "column", id: titularId, type: "text" },
            enderecos: {
              kind: "owned",
              array: true,
              shape: { cidade: { kind: "column", type: "text" } },
            },
          },
        },
      },
    });

    const conta = (await getEntity("conta"))!;
    expect(conta.fields.dono?.id).toBe(titularId);
    expect(conta.fields.titular).toBeUndefined();
  });

  // ── Plano de mudanças (diff por id, dry-run) — um teste por balde ───────────
  describe("plano de edição", () => {
    // Helper: ids do baseline `cliente` pra montar os IRs editados.
    const baseline = async () => {
      const { getEntity } = await import("../app/engine/control-plane/entities.js");
      const c = (await getEntity("cliente"))!;
      return {
        nome: c.fields.nome?.id,
        apelido: c.fields.apelido?.id,
        idade: c.fields.idade?.id,
      };
    };
    const plan = async (fields: Record<string, unknown>) => {
      const res = await app.as({ user: master }).action(action_planEntity, {
        body: { ir: { irVersion: 1, name: "cliente", fields } },
      });
      return (await res.json()).plan as {
        isNew: boolean;
        changes: { risk: string; op: string; path: string; fillType?: string }[];
      };
    };

    it("cria o baseline do diff", async () => {
      await app.as({ user: master }).action(action_saveEntity, {
        body: {
          ir: {
            irVersion: 1,
            name: "cliente",
            fields: {
              nome: { kind: "column", type: "text" },
              apelido: { kind: "column", type: "text" },
              idade: { kind: "column", type: "int4" },
            },
          },
        },
      });
      const ids = await baseline();
      expect(ids.nome).toBeTruthy();
    });

    it("🟢 rename (mesmo id, nome novo) é auto", async () => {
      const id = await baseline();
      const p = await plan({
        nome_completo: { kind: "column", id: id.nome, type: "text" },
        apelido: { kind: "column", id: id.apelido, type: "text" },
        idade: { kind: "column", id: id.idade, type: "int4" },
      });
      expect(p.changes.find((c) => c.op === "renameField")).toMatchObject({
        risk: "auto",
        path: "nomeCompleto", // input snake → camelize → nomeCompleto
      });
    });

    it("🟢 adicionar campo opcional é auto", async () => {
      const id = await baseline();
      const p = await plan({
        nome: { kind: "column", id: id.nome, type: "text" },
        apelido: { kind: "column", id: id.apelido, type: "text" },
        idade: { kind: "column", id: id.idade, type: "int4" },
        email: { kind: "column", type: "text" },
      });
      expect(p.changes.find((c) => c.path === "email")).toMatchObject({ risk: "auto", op: "addField" });
    });

    it("🔴 remover campo pede confirmação", async () => {
      const id = await baseline();
      const p = await plan({
        nome: { kind: "column", id: id.nome, type: "text" },
        idade: { kind: "column", id: id.idade, type: "int4" },
      });
      expect(p.changes.find((c) => c.op === "removeField")).toMatchObject({
        risk: "confirm",
        path: "apelido",
      });
    });

    it("🟡 tornar obrigatório precisa de um valor", async () => {
      const id = await baseline();
      const p = await plan({
        nome: { kind: "column", id: id.nome, type: "text" },
        apelido: { kind: "column", id: id.apelido, type: "text" },
        idade: { kind: "column", id: id.idade, type: "int4", notNull: true },
      });
      expect(p.changes.find((c) => c.op === "makeRequired")).toMatchObject({
        risk: "needsValue",
        path: "idade",
        fillType: "int4",
      });
    });

    it("⛔ tornar único é bloqueado", async () => {
      const id = await baseline();
      const p = await plan({
        nome: { kind: "column", id: id.nome, type: "text", unique: true },
        apelido: { kind: "column", id: id.apelido, type: "text" },
        idade: { kind: "column", id: id.idade, type: "int4" },
      });
      expect(p.changes.find((c) => c.op === "addUnique")).toMatchObject({ risk: "blocked", path: "nome" });
    });

    it("⛔ mudar tipo é bloqueado", async () => {
      const id = await baseline();
      const p = await plan({
        nome: { kind: "column", id: id.nome, type: "text" },
        apelido: { kind: "column", id: id.apelido, type: "text" },
        idade: { kind: "column", id: id.idade, type: "text" }, // int4 → text
      });
      expect(p.changes.find((c) => c.op === "retypeField")).toMatchObject({ risk: "blocked", path: "idade" });
    });

    it("sem id, um rename vira remover + adicionar (drop+add)", async () => {
      const id = await baseline();
      // 'nome' some e 'nome_completo' aparece SEM id → não é rename.
      const p = await plan({
        nome_completo: { kind: "column", type: "text" },
        apelido: { kind: "column", id: id.apelido, type: "text" },
        idade: { kind: "column", id: id.idade, type: "int4" },
      });
      expect(p.changes.find((c) => c.op === "renameField")).toBeUndefined();
      expect(p.changes.find((c) => c.op === "removeField")).toMatchObject({ path: "nome" });
      expect(p.changes.find((c) => c.op === "addField")).toMatchObject({ path: "nomeCompleto" });
    });

    it("entidade nova não tem mudanças a revisar (isNew)", async () => {
      const res = await app.as({ user: master }).action(action_planEntity, {
        body: { ir: { irVersion: 1, name: "marca_nova_xyz", fields: { x: { kind: "column", type: "text" } } } },
      });
      const p = (await res.json()).plan as { isNew: boolean; changes: unknown[] };
      expect(p.isNew).toBe(true);
      expect(p.changes).toEqual([]);
    });
  });

  // ── Aplicação real do plano (migração com dado nas tabelas) ─────────────────
  describe("aplicação do plano", () => {
    const save = (name: string, fields: Record<string, unknown>, extra: object = {}) =>
      app.as({ user: master }).action(action_saveEntity, {
        body: { ir: { irVersion: 1, name, fields }, ...extra },
      });
    const idOf = async (ent: string, field: string) => {
      const { getEntity } = await import("../app/engine/control-plane/entities.js");
      return (await getEntity(ent))!.fields[field]?.id;
    };
    const sqlH = async () => (await import("../app/engine/control-plane/db.js")).db();
    const columns = async (table: string) => {
      const sql = await sqlH();
      const rows = await sql<{ column_name: string; is_nullable: string }[]>`
        SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}`;
      return rows;
    };

    it("🟢 rename preserva o dado da linha", async () => {
      await save("ra", { titulo: { kind: "column", type: "text" } });
      const id = await idOf("ra", "titulo");
      const sql = await sqlH();
      await sql`INSERT INTO ra (titulo) VALUES ('hello')`;

      const res = await save("ra", { nome: { kind: "column", id, type: "text" } });
      expect((await res.json()).status).toBe("applied");

      const [row] = await sql<{ nome: string }[]>`SELECT nome FROM ra`;
      expect(row?.nome).toBe("hello"); // dado migrou pra coluna renomeada
      const cols = (await columns("ra")).map((c) => c.column_name);
      expect(cols).toContain("nome");
      expect(cols).not.toContain("titulo");
    });

    it("🔴 remover campo: sem confirmação não aplica; com confirmação dropa", async () => {
      await save("rb", { a: { kind: "column", type: "text" }, b: { kind: "column", type: "text" } });
      const idA = await idOf("rb", "a");

      const blocked = await save("rb", { a: { kind: "column", id: idA, type: "text" } });
      expect((await blocked.json()).status).toBe("needsReview");
      expect((await columns("rb")).map((c) => c.column_name)).toContain("b"); // intacto

      const ok = await save("rb", { a: { kind: "column", id: idA, type: "text" } }, { confirm: ["b"] });
      expect((await ok.json()).status).toBe("applied");
      expect((await columns("rb")).map((c) => c.column_name)).not.toContain("b");
    });

    it("🟡 obrigatório com vazios: trava sem valor, aplica com backfill", async () => {
      await save("rc", { nome: { kind: "column", type: "text" }, idade: { kind: "column", type: "int4" } });
      const idNome = await idOf("rc", "nome");
      const idIdade = await idOf("rc", "idade");
      const sql = await sqlH();
      await sql`INSERT INTO rc (nome) VALUES ('x')`; // idade NULL

      const req = {
        nome: { kind: "column", id: idNome, type: "text" },
        idade: { kind: "column", id: idIdade, type: "int4", notNull: true },
      };
      const blocked = await save("rc", req);
      expect((await blocked.json()).status).toBe("needsReview");

      const ok = await save("rc", req, { fill: { idade: 0 } });
      expect((await ok.json()).status).toBe("applied");
      const [row] = await sql<{ idade: number }[]>`SELECT idade FROM rc`;
      expect(row?.idade).toBe(0); // vazio preenchido
      const col = (await columns("rc")).find((c) => c.column_name === "idade");
      expect(col?.is_nullable).toBe("NO"); // virou NOT NULL
    });

    it("🟢 obrigatório sem vazios aplica direto (auto, sem valor)", async () => {
      await save("rd", { idade: { kind: "column", type: "int4" } });
      const id = await idOf("rd", "idade");
      const sql = await sqlH();
      await sql`INSERT INTO rd (idade) VALUES (7)`; // sem nulos

      const res = await save("rd", { idade: { kind: "column", id, type: "int4", notNull: true } });
      expect((await res.json()).status).toBe("applied");
      const col = (await columns("rd")).find((c) => c.column_name === "idade");
      expect(col?.is_nullable).toBe("NO");
    });

    it("⛔ único com duplicatas trava; sem duplicatas aplica", async () => {
      const sql = await sqlH();

      await save("re", { code: { kind: "column", type: "text" } });
      const idDup = await idOf("re", "code");
      await sql`INSERT INTO re (code) VALUES ('dup'), ('dup')`;
      const blocked = await save("re", { code: { kind: "column", id: idDup, type: "text", unique: true } });
      expect((await blocked.json()).status).toBe("needsReview");

      await save("rf", { code: { kind: "column", type: "text" } });
      const idOk = await idOf("rf", "code");
      await sql`INSERT INTO rf (code) VALUES ('a'), ('b')`;
      const ok = await save("rf", { code: { kind: "column", id: idOk, type: "text", unique: true } });
      expect((await ok.json()).status).toBe("applied");
      // a constraint unique passa a barrar duplicata
      await expect(sql`INSERT INTO rf (code) VALUES ('a')`).rejects.toThrow();
    });
  });

  it("rejeita nome de entidade reservado (order)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: { ir: { irVersion: 1, name: "order", fields: { x: { kind: "column", type: "text" } } } },
    });
    expect((await res.json()).error).toMatch(/reserved/i);
  });

  it("rejeita coluna escalar com nome reservado (select)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: { ir: { irVersion: 1, name: "coisa", fields: { select: { kind: "column", type: "text" } } } },
    });
    expect((await res.json()).error).toMatch(/reserved/i);
  });

  it("permite 'user'/'order' como reference/owned (viram _id e pai__filho)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "thing2",
          fields: {
            user: { kind: "reference", target: "thing2", cardinality: "one" }, // → user_id
            order: { kind: "owned", array: true, shape: { qty: { kind: "column", type: "int4" } } }, // → thing2__order
          },
        },
      },
    });
    expect(await res.json()).toMatchObject({ ok: true, name: "thing2" });
  });

  it("rejeita IR inválido (tipo fora do catálogo)", async () => {
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: { ir: { irVersion: 1, name: "bad", fields: { x: { kind: "column", type: "naoexiste" } } } },
    });
    expect((await res.json()).error).toBeTruthy();
  });

  it("owned-array com scalar *Id agora materializa (FK plural não colide com o singular)", async () => {
    // dbPresets → tabela db_presets; o child ganha o link `presets_id` (plural), que NÃO
    // colide com o scalar `presetId` → `preset_id`. O caso do PodCubo passou a funcionar.
    const res = await app.as({ user: master }).action(action_saveEntity, {
      body: {
        ir: {
          irVersion: 1,
          name: "dbPresets",
          fields: {
            presets: {
              kind: "owned",
              array: true,
              shape: {
                presetId: { kind: "column", type: "text", notNull: true },
                name: { kind: "column", type: "text", notNull: true },
              },
            },
          },
        },
      },
    });
    expect((await res.json()).status).toBe("applied");
    const sql = (await import("../app/engine/control-plane/db.js")).db();
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='db_presets__presets'`;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("presets_id"); // o link pro pai (plural)
    expect(names).toContain("preset_id"); // o scalar presetId — coexistem
  });

  describe("único/índice composto (aplicação)", () => {
    const saveIR = (ir: object, extra: object = {}) =>
      app.as({ user: master }).action(action_saveEntity, { body: { ir, ...extra } });
    const sqlH = async () => (await import("../app/engine/control-plane/db.js")).db();
    const idOf = async (ent: string, field: string) => {
      const { getEntity } = await import("../app/engine/control-plane/entities.js");
      return (await getEntity(ent))!.fields[field]?.id;
    };
    const indexExists = async (name: string) => {
      const sql = await sqlH();
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname=${name}`;
      return (rows[0]?.n ?? 0) > 0;
    };

    it("entidade nova com unique composto materializa o índice e barra a duplicata", async () => {
      const res = await saveIR({
        irVersion: 1,
        name: "cuq",
        fields: {
          host: { kind: "column", type: "text", notNull: true },
          route: { kind: "column", type: "text", notNull: true },
        },
        unique: [["host", "route"]],
      });
      expect((await res.json()).status).toBe("applied");
      expect(await indexExists("cuq_host_route_key")).toBe(true);

      const sql = await sqlH();
      await sql`INSERT INTO cuq (host, route) VALUES ('a', '/x')`;
      await sql`INSERT INTO cuq (host, route) VALUES ('a', '/y')`; // combinação diferente: ok
      await expect(sql`INSERT INTO cuq (host, route) VALUES ('a', '/x')`).rejects.toThrow(); // viola o unique
    });

    it("unique composto com reference resolve pra <campo>_id e é enforçado", async () => {
      await saveIR({ irVersion: 1, name: "custack", fields: { name: { kind: "column", type: "text", notNull: true } } });
      const res = await saveIR({
        irVersion: 1,
        name: "cureg",
        fields: {
          slugName: { kind: "column", type: "text", notNull: true },
          stack: { kind: "reference", target: "custack", cardinality: "one" },
        },
        unique: [["slugName", "stack"]],
      });
      expect((await res.json()).status).toBe("applied");
      expect(await indexExists("cureg_slug_name_stack_id_key")).toBe(true);

      const sql = await sqlH();
      const [s1] = await sql<{ id: string }[]>`INSERT INTO custack (name) VALUES ('s1') RETURNING id`;
      const [s2] = await sql<{ id: string }[]>`INSERT INTO custack (name) VALUES ('s2') RETURNING id`;
      await sql`INSERT INTO cureg (slug_name, stack_id) VALUES ('web', ${s1!.id})`;
      await sql`INSERT INTO cureg (slug_name, stack_id) VALUES ('web', ${s2!.id})`; // mesmo slug, stack diferente: ok
      await expect(
        sql`INSERT INTO cureg (slug_name, stack_id) VALUES ('web', ${s1!.id})`,
      ).rejects.toThrow(); // mesma combinação: barrada
    });

    it("adicionar unique composto: com duplicata trava (needsReview), sem duplicata aplica", async () => {
      await saveIR({
        irVersion: 1,
        name: "cuq",
        fields: {
          host: { kind: "column", type: "text", notNull: true },
          route: { kind: "column", type: "text", notNull: true },
        },
      });
      // (cuq foi recriada sem unique; herda os ids atuais dos campos)
      const idH = await idOf("cuq", "host");
      const idR = await idOf("cuq", "route");
      const sql = await sqlH();
      await sql`INSERT INTO cuq (host, route) VALUES ('dup', '/z')`;
      await sql`INSERT INTO cuq (host, route) VALUES ('dup', '/z')`; // duplicata plantada

      const withUnique = {
        irVersion: 1,
        name: "cuq",
        fields: {
          host: { kind: "column", id: idH, type: "text", notNull: true },
          route: { kind: "column", id: idR, type: "text", notNull: true },
        },
        unique: [["host", "route"]],
      };
      const blocked = await saveIR(withUnique);
      const bj = await blocked.json();
      expect(bj.status).toBe("needsReview");
      expect(bj.plan.changes.some((c: { op: string }) => c.op === "addCompositeUnique")).toBe(true);

      await sql`DELETE FROM cuq WHERE ctid IN (SELECT ctid FROM cuq WHERE host='dup' LIMIT 1)`; // resolve a duplicata
      const ok = await saveIR(withUnique);
      expect((await ok.json()).status).toBe("applied");
      expect(await indexExists("cuq_host_route_key")).toBe(true);
    });

    it("o designer renderiza o composto de uma entidade existente (SSR)", async () => {
      // `cuq` acabou de ficar com unique [host, route] — a seção Index deve mostrá-lo.
      const res = await app.as({ user: master }).get("/entities/cuq");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("add index"); // a seção renderiza
      // os campos do grupo aparecem como chips removíveis (`nome ✕`).
      expect(html).toContain("host ✕");
      expect(html).toContain("route ✕");
    });
  });

  describe("delete de entity", () => {
    const sqlH = async () => (await import("../app/engine/control-plane/db.js")).db();
    const tablesLike = async (prefix: string): Promise<string[]> => {
      const sql = await sqlH();
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE ${prefix + "%"}`;
      return rows.map((r) => r.table_name);
    };

    it("dropa as tabelas (raiz + owned) e limpa o metastore", async () => {
      await app.as({ user: master }).action(action_saveEntity, {
        body: {
          ir: {
            irVersion: 1,
            name: "delme",
            fields: {
              title: { kind: "column", type: "text" },
              items: { kind: "owned", array: true, shape: { sku: { kind: "column", type: "text" } } },
            },
          },
        },
      });
      expect((await tablesLike("delme")).length).toBeGreaterThanOrEqual(2); // delme + delme__items

      const res = await app.as({ user: master }).action(action_deleteEntity, { body: { name: "delme" } });
      expect((await res.json()).ok).toBe(true);

      expect(await tablesLike("delme")).toEqual([]); // tabelas físicas foram-se
      const { getEntity } = await import("../app/engine/control-plane/entities.js");
      expect(await getEntity("delme")).toBeNull(); // metastore limpo
    });

    it("botão Delete: presente na entity existente, ausente na nova (SSR)", async () => {
      const novo = await (await app.as({ user: master }).get("/entities/new")).text();
      expect(novo).not.toContain(">Delete<");
      const edit = await (await app.as({ user: master }).get("/entities/products")).text();
      expect(edit).toContain(">Delete<");
    });

    it("designer exibe a entity em camelCase (nome lógico) + tabela snake no preview (SSR)", async () => {
      await app.as({ user: master }).action(action_saveEntity, {
        body: { ir: { irVersion: 1, name: "backupStorages", fields: { label: { kind: "column", type: "text" } } } },
      });
      const html = await (await app.as({ user: master }).get("/entities/backup_storages")).text();
      expect(html).toContain("backupStorages"); // nome lógico no título/input
      expect(html).toContain("backup_storages"); // a TABELA aparece no preview "Tables to be created"
    });

    it("deletar uma entity REFERENCIADA não trava as operações seguintes (ref pendurada tolerada)", async () => {
      // "apps" é referenciada por "stacks".
      await app.as({ user: master }).action(action_saveEntity, {
        body: { ir: { irVersion: 1, name: "apps", fields: { name: { kind: "column", type: "text", notNull: true } } } },
      });
      await app.as({ user: master }).action(action_saveEntity, {
        body: {
          ir: {
            irVersion: 1,
            name: "stacks",
            fields: {
              name: { kind: "column", type: "text", notNull: true },
              app: { kind: "reference", target: "apps", cardinality: "one" },
            },
          },
        },
      });

      // deleta "apps" (referenciada) — ok
      const d1 = await app.as({ user: master }).action(action_deleteEntity, { body: { name: "apps" } });
      expect((await d1.json()).ok).toBe(true);

      // agora deletar OUTRA entity ("stacks", que tinha a ref pendurada pra "apps") NÃO pode
      // estourar "reference to unknown entity: 'apps'".
      const d2 = await app.as({ user: master }).action(action_deleteEntity, { body: { name: "stacks" } });
      const j2 = await d2.json();
      expect(j2.error).toBeUndefined();
      expect(j2.ok).toBe(true);
    });
  });
});
