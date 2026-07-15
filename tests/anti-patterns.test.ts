/**
 * Spec executável do `packages/sdk/agent/AGENTS.md` → "Rules that fail silently".
 *
 * Cada regra daquela tabela é pinada aqui: o anti-padrão entra, a consequência
 * documentada sai. Estes testes afirmam comportamento QUEBRADO de propósito — é o
 * contrato que a regra descreve.
 *
 * A tabela e este arquivo se checam pelo teste de paridade no fim, então não têm como
 * divergir:
 *  - regra nova sem teste                          → vermelho
 *  - bug consertado, teste apagado, linha na tabela → vermelho
 *  - regra reescrita sem revisitar o teste          → vermelho
 *
 * Quando um teste daqui falhar, NÃO conserte o teste. Ou algo regrediu, ou o Weave
 * melhorou e o anti-padrão agora funciona — e nesse caso APAGUE a linha do
 * `packages/sdk/agent/AGENTS.md` e apague o teste. Regra que avisa de um problema que não existe mais
 * é mentira que custa contexto em toda conversa. Isto já aconteceu 3× no primeiro dia:
 * `findMany` truncando em 10k, `aggregate` devolvendo string e o operador desconhecido
 * virando `[object Object]` eram linhas desta tabela — foram consertados e as linhas
 * morreram. Consertar > avisar > documentar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_createKey } from "../app/pages/Api.js";
import { runCli } from "@mauroandre/weave-sdk/cli";
import {
  createClient,
  defineEntity,
  defineScope,
  scopeRule,
  pushScopes,
  text,
  int4,
  reference,
  array,
} from "@mauroandre/weave-sdk";

// ============================================
// O acoplamento com o AGENTS.md
// ============================================

const AGENTS_MD = fileURLToPath(new URL("../packages/sdk/agent/AGENTS.md", import.meta.url));
const SECTION = "Rules that fail silently";

/** A célula "Never write" de cada linha da tabela de falhas silenciosas. */
function declaredRules(): string[] {
  const md = fs.readFileSync(AGENTS_MD, "utf-8");
  const section = md.split(/^## /m).find((s) => s.startsWith(SECTION));
  if (!section) throw new Error(`packages/sdk/agent/AGENTS.md: seção "## ${SECTION}" não encontrada`);

  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  if (rows.length < 3) throw new Error(`packages/sdk/agent/AGENTS.md: "${SECTION}" não tem linhas de tabela`);

  // `| a | b | c |`.split("|") → ["", " a ", " b ", " c ", ""]
  return rows.slice(2).map((line) => {
    const cells = line.split("|");
    if (cells.length < 4) throw new Error(`packages/sdk/agent/AGENTS.md: linha malformada: ${line}`);
    return cells[1]!.trim();
  });
}

/**
 * Cópia VERBATIM da 1ª célula de cada linha. Este objeto É a afirmação "estas são as
 * regras que este arquivo pina"; o teste de paridade prova a afirmação contra a tabela
 * real, então um typo aqui é pego em vez de despinar uma regra em silêncio.
 */
const RULE = {
  nnReplace: "`updateOne(where, { tagsIds: [newId] })` to add a link",
  genWipes: "hand-written code in `weave/entities/` or `weave/scopes/`",
  nullableDefault: "`price: int4()` when the field is required",
  scopeExpandRows: "relying on a scope's `where` to protect an entity you reach via `expand`",
} as const;

const pinned = new Set<string>();

/**
 * Declara um teste E registra que regra ele pina. O registro acontece em tempo de
 * COLETA — quando o corpo do `describe` roda —, não quando o teste roda, pra um filtro
 * `-t` nunca conseguir fazer a paridade mentir sobre a cobertura.
 */
function ruleTest(rule: string, name: string, fn: () => void | Promise<void>, timeout?: number): void {
  pinned.add(rule);
  it(name, fn, timeout);
}

// ============================================
// Fixture compartilhada (um app pra todos)
// ============================================

const tag = defineEntity("aptag", { label: text().notNull() });
const co = defineEntity("apco", { name: text().notNull() });
const secret = defineEntity("apsecret", { code: text().notNull() });
const post = defineEntity("appost", {
  title: text().notNull(),
  price: int4(), // NULLABLE por default — de propósito (regra `nullableDefault`)
  co: reference(co),
  secret: reference(secret),
  tags: reference(array(tag)),
});

let app: Awaited<ReturnType<typeof createTestApp>>;
let key = "";
let acmeId = "";
const entities = { aptag: tag, apco: co, apsecret: secret, appost: post };
const base = () => ({ url: "http://localhost", key, entities, fetch: (r: Request) => app.hono.fetch(r) });
const god = () => createClient(base());

// scope que só filtra LINHAS de appost — e não tem filtro em apsecret.
const tenant = defineScope("aptenant", [
  scopeRule(post, { verbs: ["read"], where: { co: { id: { eq: { param: "co" } } } } }),
  scopeRule(secret, { verbs: ["read"], where: { code: { eq: "NUNCA" } } }), // filtro que nada casa
  scopeRule(co, { verbs: ["read"] }),
]);

beforeAll(async () => {
  app = await createTestApp({
    routes,
    bootstrap: async () => {
      const { setup } = await import("../app/engine/control-plane/setup.js");
      await setup();
      const { db } = await import("../app/engine/control-plane/db.js");
      const sql = db();
      await sql`DROP TABLE IF EXISTS appost__tags, appost, apsecret, apco, aptag CASCADE`;
      await sql`DELETE FROM weave_entities WHERE name IN ('appost','apsecret','apco','aptag')`;
      await sql`DELETE FROM weave_scopes WHERE name = 'aptenant'`;
      await sql`DELETE FROM weave_api_keys`;
      const { applyEntity } = await import("../app/engine/control-plane/entities.js");
      await applyEntity({ irVersion: 1, name: "aptag", fields: { label: { kind: "column", type: "text", notNull: true } } });
      await applyEntity({ irVersion: 1, name: "apco", fields: { name: { kind: "column", type: "text", notNull: true } } });
      await applyEntity({ irVersion: 1, name: "apsecret", fields: { code: { kind: "column", type: "text", notNull: true } } });
      await applyEntity({
        irVersion: 1,
        name: "appost",
        fields: {
          title: { kind: "column", type: "text", notNull: true },
          price: { kind: "column", type: "int4" },
          co: { kind: "reference", target: "apco", cardinality: "one" },
          secret: { kind: "reference", target: "apsecret", cardinality: "one" },
          tags: { kind: "reference", target: "aptag", cardinality: "many" },
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
  const res = await app.as({ user: master }).action(action_createKey, { body: { name: "ap" } });
  key = (await res.json()).key as string;
  acmeId = (await god().apco.create({ name: "Acme" })).id;
  await pushScopes({ tenant }, base());
});

afterAll(async () => {
  await app.close();
  const { closeDb } = await import("../app/engine/control-plane/db.js");
  await closeDb();
});

// ============================================
// N:N — `<field>Ids` substitui o conjunto
// ============================================

describe("anti-pattern: <field>Ids como `connect`", () => {
  ruleTest(RULE.nnReplace, "`tagsIds: [novo]` no update APAGA os links que você omitiu", async () => {
    const a = await god().aptag.create({ label: "a" });
    const b = await god().aptag.create({ label: "b" });
    const c = await god().aptag.create({ label: "c" });
    const p = await god().appost.create({ title: "nn", coId: acmeId, tagsIds: [a.id, b.id] });

    const before = await god().appost.findOne({ id: p.id }, { expand: { tags: true } });
    expect(((before as { tags: { label: string }[] }).tags).map((t) => t.label).sort()).toEqual(["a", "b"]);

    // O reflexo `connect`: "adicionar a tag c".
    await god().appost.updateOne({ id: p.id }, { tagsIds: [c.id] });

    const after = await god().appost.findOne({ id: p.id }, { expand: { tags: true } });
    // `a` e `b` foram DELETADOS. Sem erro, sem aviso.
    expect(((after as { tags: { label: string }[] }).tags).map((t) => t.label)).toEqual(["c"]);
  });

  it("a forma certa (ler o conjunto e escrever inteiro) preserva — controle", async () => {
    const a = await god().aptag.create({ label: "x" });
    const c = await god().aptag.create({ label: "y" });
    const p = await god().appost.create({ title: "ok", coId: acmeId, tagsIds: [a.id] });
    const cur = (await god().appost.findOne({ id: p.id })) as { tagsIds?: string[] };
    void cur;
    await god().appost.updateOne({ id: p.id }, { tagsIds: [a.id, c.id] });
    const after = await god().appost.findOne({ id: p.id }, { expand: { tags: true } });
    expect(((after as { tags: { label: string }[] }).tags).map((t) => t.label).sort()).toEqual(["x", "y"]);
  });
});

// ============================================
// `weave gen` / `weave push` apagam weave/entities e weave/scopes
// ============================================

describe("anti-pattern: código à mão em weave/entities|scopes", () => {
  ruleTest(
    RULE.genWipes,
    "`weave gen` apaga o arquivo escrito à mão e sai com código 0",
    async () => {
      // fs REAL: o `clean`/`write` default são `fs.rm`/`fs.writeFile`, sem mock —
      // mockar `clean` só provaria que ele foi CHAMADO, não que o arquivo some.
      const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "weave-ap-"));
      try {
        const scopesDir = path.join(root, "weave", "scopes");
        await fs.promises.mkdir(scopesDir, { recursive: true });
        const mine = path.join(scopesDir, "my-dispatch-table.ts");
        await fs.promises.writeFile(mine, "export const runInScope = 'meu código';\n");

        const code = await runCli(["gen"], {
          fetch: (r) => app.hono.fetch(r),
          env: { WEAVE_URL: "http://localhost", WEAVE_KEY: key },
          cwd: root,
          log: () => {},
        });

        expect(code).toBe(0); // ← sucesso, inclusive
        await expect(fs.promises.access(mine)).rejects.toThrow(); // ← e o arquivo sumiu
      } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

// ============================================
// Nullable por default (o inverso do Prisma)
// ============================================

describe("anti-pattern: coluna sem .notNull()", () => {
  ruleTest(RULE.nullableDefault, "`int4()` aceita create SEM o campo e grava null", async () => {
    // Em Prisma `price Int` é obrigatório; aqui `int4()` é o `Int?` dele.
    const p = await god().appost.create({ title: "sem preço", coId: acmeId });
    expect(p.price).toBeNull(); // sem erro de tipo, sem exceção
  });
});

// ============================================
// Scope: o `where` não compõe pelo expand
// ============================================

describe("anti-pattern: confiar no `where` do scope de uma entity expandida", () => {
  ruleTest(
    RULE.scopeExpandRows,
    "o filtro de linhas da entity expandida é ignorado (verbo e projeção não são)",
    async () => {
      const s = await god().apsecret.create({ code: "VISIVEL" });
      await god().appost.create({ title: "exp", coId: acmeId, secretId: s.id });
      const scoped = god().as(tenant, { co: acmeId });

      // Direto: o `where` do scope em apsecret (code = "NUNCA") não casa nada.
      expect(await scoped.apsecret.findMany()).toHaveLength(0);

      // Pela referência: a MESMA linha volta — o `where` do alvo não viajou.
      const rows = await scoped.appost.findMany({ title: "exp" }, { expand: { secret: true } });
      expect((rows[0] as { secret: { code: string } }).secret.code).toBe("VISIVEL");
    },
  );

  it("verbo e projeção COMPÕEM pela referência — controle (o que a regra NÃO diz)", async () => {
    // A regra é estreita de propósito: só o filtro de LINHAS não compõe.
    const noRule = defineScope("apnorule", [scopeRule(post, { verbs: ["read"] }), scopeRule(co, { verbs: ["read"] })]);
    await pushScopes({ noRule }, base());
    const scoped = god().as(noRule, {});
    await expect(scoped.appost.findMany({}, { expand: { secret: true } })).rejects.toMatchObject({ status: 403 });
  });
});

// ============================================
// O acoplamento em si
// ============================================

describe("agent/AGENTS.md ↔ este arquivo", () => {
  it("pina exatamente as regras que a tabela declara — nem mais, nem menos", () => {
    const declared = declaredRules();

    // Regra no AGENTS.md que nada aqui pina: prosa não verificada, que é como a doc
    // apodreceu em primeiro lugar. Pina, ou apaga a linha.
    const unpinned = declared.filter((rule) => !pinned.has(rule));

    // Regra pinada aqui que o AGENTS.md não declara mais: ou a linha foi reescrita
    // (atualize o RULE) ou caiu (apague o teste).
    const orphaned = [...pinned].filter((rule) => !declared.includes(rule));

    expect({ unpinned, orphaned }).toEqual({ unpinned: [], orphaned: [] });
  });

  it("toda regra declarada é única, pra uma linha não ser pinada por acidente", () => {
    const declared = declaredRules();
    expect(declared).toEqual([...new Set(declared)]);
  });
});
