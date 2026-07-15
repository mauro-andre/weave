import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { createClient, defineEntity, text } from "@mauroandre/weave-sdk";

// O corte do `findMany` NUNCA é mudo.
//
// O teto default (10k) existe pra você não puxar uma tabela inteira sem querer — mas bater
// nele era INVISÍVEL: 10 001 linhas casavam, voltavam 10 000, e a lista parecia completa
// (envenenando qualquer contagem feita em cima). O servidor devolve `docsQuantity` (o total
// real), então o SDK sabe que cortou e avisa NO PROCESSO DO DEV. `limit` explícito = escolha
// sua = silêncio.

const row = defineEntity("limrow", { tag: text().notNull() });
const CAP = 10_000;

describe("findMany — o teto default avisa quando corta", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let key = "";
  const entities = { limrow: row };
  const base = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
  const god = () => createClient(base());

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS limrow CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name = 'limrow'`;
        await sql`DELETE FROM weave_api_keys`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "limrow", fields: { tag: { kind: "column", type: "text", notNull: true } } });
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = (await findUserByUsername(process.env.MASTER_USERNAME!))!;
    const res = await app.as({ user: master }).action(action_createKey, { body: { name: "lim" } });
    key = (await res.json()).key as string;
    // UMA linha a mais que o teto — o menor caso que expõe o corte.
    await god().limrow.createMany(Array.from({ length: CAP + 1 }, (_, i) => ({ tag: `t${i}` })));
  }, 180_000);

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("corta no teto default, mas AVISA (com os dois números)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await god().limrow.findMany();
    expect(rows).toHaveLength(CAP); // o teto continua valendo (rede de segurança)
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]![0]);
    expect(msg).toContain(`returned ${CAP} of ${CAP + 1} matching rows`);
    expect(msg).toContain("limit"); // diz o que fazer
    warn.mockRestore();
  }, 60_000);

  it("`limit` explícito acima do total → devolve tudo, sem avisar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await god().limrow.findMany({}, { limit: 20_000 });
    expect(rows).toHaveLength(CAP + 1); // o teto do servidor não trava um pedido explícito
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  }, 60_000);

  it("`limit` explícito ABAIXO do total → corta calado (a escolha é sua)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await god().limrow.findMany({}, { limit: 5 });
    expect(rows).toHaveLength(5);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resultado dentro do teto → nada de aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await god().limrow.findMany({ tag: "t1" });
    expect(rows).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("paginate não é afetado (quem manda é o perPage)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = await god().limrow.paginate({}, { page: 1, perPage: 10 });
    expect(p.docs).toHaveLength(10);
    expect(p.docsQuantity).toBe(CAP + 1); // e o total real continua visível
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
