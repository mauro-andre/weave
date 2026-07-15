import type { Context } from "hono";
import type { Filter } from "../engine/control-plane/filter.js";
import type { Verb, Scope } from "../engine/control-plane/scopes.js";
import { tableize, systemColumnName } from "@mauroandre/weave-core";
import type { EntityIR, FieldIR } from "@mauroandre/weave-core";

export class ScopeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const METHOD_VERB: Record<string, Verb> = {
  GET: "read",
  POST: "create",
  PATCH: "update",
  DELETE: "delete",
};

interface ResolvedProjection {
  mode: "include" | "exclude";
  paths: string[][]; // já em NOMES
}

/** Fragmento WhereInput (frouxo) — o filtro de linhas do scope resolvido. */
type WNode = Record<string, unknown>;

export interface Access {
  god: boolean;
  rows: WNode | null; // WhereInput resolvido (nomes + params preenchidos)
  projection: ResolvedProjection | null;
}

/** Uma entity ALCANÇADA por referência (expand/select): onde ela está no doc + a projeção
 *  da regra DELA no scope. O caminho é em nomes, relativo à raiz (owned no meio inclusive). */
export interface ReachedRule {
  path: string[];
  projection: ResolvedProjection | null;
}

/** Mapa de expand/select (o mesmo formato dos dois): campo → `true` | submapa. */
type Spec = { [field: string]: unknown };

/**
 * Resolve o acesso da requisição p/ (entidade, verbo). Sem header `x-weave-scope`
 * → god (a key é o segredo confiável). Com scope: checa verbo, resolve o filtro de
 * linhas (id→nome + params do header) e a projeção (id→nome). Lança ScopeError.
 */
export async function resolveAccess(c: Context, entity: string, verb: Verb): Promise<Access> {
  entity = tableize(entity); // camelCase do SDK → nome de tabela guardado
  const scopeName = c.req.header("x-weave-scope");
  if (!scopeName) return { god: true, rows: null, projection: null };

  const scope = await loadScope(c, scopeName);
  if (!scope) throw new ScopeError(`Unknown scope '${scopeName}'.`, 403);
  // As chaves do scope são o nome de entity que o dev escreveu (camelCase) — casa por
  // nome de tabela normalizado, pra bater com o `entity` já tableizado.
  const rules = new Map(Object.entries(scope.entities).map(([k, v]) => [tableize(k), v] as const));
  const rule = rules.get(entity);
  if (!rule) throw new ScopeError(`Scope '${scopeName}' has no access to '${entity}'.`, 403);
  if (!rule.verbs.includes(verb)) throw new ScopeError(`Scope '${scopeName}' can't ${verb} '${entity}'.`, 403);

  const byName = await resolvedShapes(c);
  const params = parseParams(c.req.header("x-weave-params"));
  const rows = rule.rows ? resolveFilter(entity, byName, rule.rows, params) : null;
  const projection = rule.fields
    ? { mode: rule.fields.mode, paths: resolvePaths(entity, byName, rule.fields.paths) }
    : null;
  return { god: false, rows, projection };
}

/**
 * Resolve o acesso das entities ALCANÇADAS por referência num `expand`/`select`.
 *
 * O `resolveAccess` vale pra entity da ROTA. Mas `expand`/`select` hidratam referências
 * por baixo, no query layer — que é agnóstico de scope. Sem isto, alcançar uma entity por
 * referência ignorava a regra dela: uma entity sem regra (403 no acesso direto) voltava
 * INTEIRA, e um `fields.exclude` era furado pelo expand. A garantia é: **alcançar por
 * referência vale o mesmo que acessar** — mesmo verbo (`read`), mesma projeção.
 *
 * Dois modos, pela ORIGEM do spec (ver `readSpec`):
 *  - `deny` (expand/select EXPLÍCITO) — você pediu; sem regra ou sem `read` → **403**.
 *  - `omit` (AUTO-expand, cortesia do servidor) — ninguém pediu, então proibido não é erro:
 *    a referência simplesmente **não é expandida** (fica só a FK, como sem auto-expand).
 *    403 aqui seria o servidor punindo o cliente pela conveniência que ele mesmo aplicou.
 * Devolve o spec PODADO — no modo `omit` ele é o que vai pro query layer.
 *
 * Sem header de scope → god → nada a checar. `owned` não tem regra própria (é parte da
 * entity), então só acumula caminho e segue com o MESMO dono.
 *
 * O `where` (filtro de linhas) da entity alcançada NÃO é aplicado: filtrar a linha de um
 * JOIN é trabalho do query layer, não dá pra fazer podando o doc — e aplicá-lo mudaria
 * uma referência legítima pra `null` em silêncio (pior que o furo). Verbo e projeção
 * compõem pela referência; filtro de linha não. Decisão explícita.
 */
export async function resolveReached(
  c: Context,
  rootEntity: string,
  expand: Spec | null,
  select: Spec | null,
): Promise<{ reached: ReachedRule[]; expand: Spec | null }> {
  const scopeName = c.req.header("x-weave-scope");
  if (!scopeName) return { reached: [], expand };

  const scope = await loadScope(c, scopeName);
  if (!scope) throw new ScopeError(`Unknown scope '${scopeName}'.`, 403);
  const rules = new Map(Object.entries(scope.entities).map(([k, v]) => [tableize(k), v] as const));
  const byName = await resolvedShapes(c);
  const root = tableize(rootEntity);

  // A MESMA decisão do `listObjects`: select vence; expand ausente = auto-expand de 1 nível.
  // Feita aqui (com os IRs já em mão) pra não custar outra leitura do metastore.
  const { buildExpand } = await import("../engine/control-plane/data.js");
  const explicit = (select && Object.keys(select).length) || expand != null;
  const spec: Spec | null = explicit
    ? select && Object.keys(select).length
      ? select
      : expand
    : buildExpand(byName.get(root)?.fields ?? {});
  const mode: "deny" | "omit" = explicit ? "deny" : "omit";
  if (!spec || !Object.keys(spec).length) return { reached: [], expand };

  const out: ReachedRule[] = [];
  const walk = (owner: string, fields: Record<string, FieldIR>, node: Spec, path: string[]): Spec => {
    const kept: Spec = {};
    for (const [key, sub] of Object.entries(node)) {
      const f = fields[key];
      if (!f) continue; // campo desconhecido no spec → o query layer que reclame
      const here = [...path, key];
      if (f.kind === "owned") {
        // owned é parte do OWNER (sem regra própria) — desce mantendo o dono.
        kept[key] = sub && typeof sub === "object" ? walk(owner, f.shape ?? {}, sub as Spec, here) : sub;
        continue;
      }
      if (f.kind !== "reference") {
        kept[key] = sub; // coluna (só aparece em `select`) — nada a alcançar
        continue;
      }

      const target = tableize(f.target);
      const rule = rules.get(target);
      const canRead = rule?.verbs.includes("read") ?? false;
      if (!canRead) {
        // Pediu explicitamente → 403 (o mesmo do acesso direto). Auto-expand → só não expande.
        if (mode === "omit") continue;
        if (!rule) throw new ScopeError(`Scope '${scopeName}' has no access to '${target}'.`, 403);
        throw new ScopeError(`Scope '${scopeName}' can't read '${target}'.`, 403);
      }

      const targetFields = byName.get(target)?.fields ?? {};
      out.push({
        path: here,
        projection: rule!.fields
          ? { mode: rule!.fields.mode, paths: resolvePaths(target, byName, rule!.fields.paths) }
          : null,
      });
      kept[key] = sub && typeof sub === "object" ? walk(target, targetFields, sub as Spec, here) : sub;
    }
    return kept;
  };
  const pruned = walk(root, byName.get(root)?.fields ?? {}, spec, []);
  // Explícito: o expand do caller vale (o proibido já estourou 403 acima). Auto: devolve o
  // mapa PODADO como expand explícito — o proibido não é hidratado, e some o auto-expand.
  return { reached: out, expand: explicit ? expand : pruned };
}

/** Aplica, em cada entity alcançada, a projeção da regra DELA (poda no lugar). */
export function pruneReached(doc: Record<string, unknown>, reached: ReachedRule[]): Record<string, unknown> {
  for (const r of reached) {
    if (!r.projection) continue;
    applyAt(doc, r.path, (sub) => prune(sub, r.projection));
  }
  return doc;
}

/** Navega até `path` e substitui o nó pelo resultado de `fn` (mapeia quando é lista). */
function applyAt(
  doc: Record<string, unknown>,
  path: string[],
  fn: (sub: Record<string, unknown>) => Record<string, unknown>,
): void {
  const [head, ...rest] = path;
  if (!head) return;
  const cur = doc[head];
  if (cur == null) return;
  const step = (v: unknown): unknown => {
    if (v == null || typeof v !== "object") return v;
    if (rest.length === 0) return fn(v as Record<string, unknown>);
    applyAt(v as Record<string, unknown>, rest, fn);
    return v;
  };
  doc[head] = Array.isArray(cur) ? cur.map(step) : step(cur);
}

/** Combina o WhereInput do scope com o do usuário (AND). `{}` do usuário = sem filtro. */
export function andWhere(scopeRows: WNode | null, userWhere: WNode | null): WNode | null {
  const u = userWhere && Object.keys(userWhere).length ? userWhere : null;
  if (!scopeRows) return u;
  if (!u) return scopeRows;
  return { and: [scopeRows, u] };
}

/** Poda um objeto pela projeção (recursivo em owned/reference). `id` sempre fica. */
export function prune(doc: Record<string, unknown>, projection: ResolvedProjection | null): Record<string, unknown> {
  if (!projection) return doc;
  return pruneLevel(doc, projection.mode, projection.paths);
}

// ── internals ─────────────────────────────────────────────────────────────────

// Memo POR REQUEST (chave = o Context do Hono, que morre com o request). `getScope` e
// `listEntities` batem no banco a cada chamada e não têm cache; uma leitura escopada passa
// pelo `resolveAccess` E pelo `resolveReached`, então sem isto o request pagaria os dois
// em dobro. WeakMap: nada a invalidar, some junto com o Context.
const reqMemo = new WeakMap<object, { scope?: Promise<Scope | null>; shapes?: Promise<Map<string, EntityIR>> }>();

function memo(c: Context) {
  let m = reqMemo.get(c);
  if (!m) reqMemo.set(c, (m = {}));
  return m;
}

/** O scope do header, uma vez por request. */
async function loadScope(c: Context, name: string): Promise<Scope | null> {
  const m = memo(c);
  if (!m.scope) {
    m.scope = (async () => {
      const { getScope } = await import("../engine/control-plane/scopes.js");
      return getScope(name);
    })();
  }
  return m.scope;
}

/** Os IRs (mirrors resolvidos), uma vez por request. */
async function resolvedShapes(c?: Context): Promise<Map<string, EntityIR>> {
  const load = async (): Promise<Map<string, EntityIR>> => {
    const { listEntities } = await import("../engine/control-plane/entities.js");
    const { resolveMirrors } = await import("@mauroandre/weave-core");
    const irs = await listEntities();
    const raw = new Map(irs.map((e) => [e.name, e] as const));
    return new Map(irs.map((e) => [e.name, resolveMirrors(e, raw)] as const));
  };
  if (!c) return load();
  const m = memo(c);
  if (!m.shapes) m.shapes = load();
  return m.shapes;
}

function parseParams(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Resolve o filtro de linhas armazenado (por-id, rename-proof) num **fragmento
// WhereInput** (por-nome): ids→nomes, params preenchidos, e o caminho path-based
// vira objeto aninhado com `some` em to-many (mesmo idioma do engine/GUI/SDK).
function resolveFilter(
  rootEntity: string,
  byName: Map<string, EntityIR>,
  node: Filter,
  params: Record<string, unknown>,
): WNode {
  if ("and" in node) return { and: node.and.map((n) => resolveFilter(rootEntity, byName, n, params)) };
  if ("or" in node) return { or: node.or.map((n) => resolveFilter(rootEntity, byName, n, params)) };

  const names = idPathToNames(byName.get(rootEntity)?.fields ?? {}, byName, node.path);
  if (!names) throw new ScopeError("Scope references a field that no longer exists.", 400);
  let value = node.value as unknown;
  if (value && typeof value === "object" && "param" in (value as object)) {
    const name = (value as { param: string }).param;
    if (!(name in params)) throw new ScopeError(`Missing param '${name}' for this scope.`, 400);
    value = params[name];
  }
  return conditionToWhere(rootEntity, byName, names, node.op, value);
}

/** Caminho de nomes + op + valor → WhereInput aninhado (`some` em to-many). */
function conditionToWhere(
  rootEntity: string,
  byName: Map<string, EntityIR>,
  names: string[],
  op: string,
  value: unknown,
): WNode {
  const build = (fields: Record<string, FieldIR>, idx: number): WNode => {
    const seg = names[idx]!;
    const node = fields[seg];
    if (idx === names.length - 1) {
      const sc = leafOp(op, value);
      // Folha é uma reference N:1 → FK-shorthand direto (`{ companyId: … }`), não travessia.
      if (node?.kind === "reference" && node.cardinality === "one") return { [`${seg}Id`]: sc };
      const isArray = node?.kind === "column" && node.array === true;
      return { [seg]: isArray && op !== "isEmpty" ? { some: sc } : sc };
    }
    let nextFields: Record<string, FieldIR> = {};
    let toMany = false;
    if (node?.kind === "owned") {
      nextFields = node.shape ?? {};
      toMany = node.array === true;
    } else if (node?.kind === "reference") {
      nextFields = byName.get(node.target)?.fields ?? {};
      toMany = node.cardinality === "many";
    }
    const inner = build(nextFields, idx + 1);
    return { [seg]: toMany ? { some: inner } : inner };
  };
  return build(byName.get(rootEntity)?.fields ?? {}, 0);
}

/** Operador armazenado → objeto de operador WhereInput. */
function leafOp(op: string, value: unknown): WNode {
  switch (op) {
    case "contains":
      return { ilike: `%${value}%` };
    case "startsWith":
      return { ilike: `${value}%` };
    case "equals":
      return { eq: value };
    case "notEquals":
      return { ne: value };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { [op]: value };
    case "in":
      return { in: value };
    case "on":
      return { eq: value };
    case "before":
      return { lt: value };
    case "after":
      return { gt: value };
    case "isTrue":
      return { eq: true };
    case "isFalse":
      return { eq: false };
    case "isEmpty":
      return { isNull: true };
    default:
      return { eq: value };
  }
}

function resolvePaths(rootEntity: string, byName: Map<string, EntityIR>, idPaths: string[][]): string[][] {
  const fields = byName.get(rootEntity)?.fields ?? {};
  const out: string[][] = [];
  for (const p of idPaths) {
    const names = idPathToNames(fields, byName, p);
    if (names) out.push(names); // ids sumidos (campo deletado) são ignorados
  }
  return out;
}

/** Converte um caminho de ids de campo em caminho de nomes, descendo owned/ref. */
function idPathToNames(
  fields: Record<string, FieldIR>,
  byName: Map<string, EntityIR>,
  idPath: string[],
): string[] | null {
  const names: string[] = [];
  let cur = fields;
  for (let i = 0; i < idPath.length; i++) {
    // Sentinel de coluna de sistema (`@id`, …) → nome; é sempre FOLHA (não atravessável).
    const sysName = systemColumnName(idPath[i]!);
    if (sysName) {
      names.push(sysName);
      if (i !== idPath.length - 1) return null;
      break;
    }
    const entry = Object.entries(cur).find(([, node]) => node.id === idPath[i]);
    if (!entry) return null;
    const [name, node] = entry;
    names.push(name);
    if (i === idPath.length - 1) break;
    if (node.kind === "owned") cur = node.shape ?? {};
    else if (node.kind === "reference") cur = byName.get(node.target)?.fields ?? {};
    else return null; // mais ids, mas o campo é escalar → inválido
  }
  return names;
}

function pruneLevel(
  doc: Record<string, unknown>,
  mode: "include" | "exclude",
  paths: string[][],
): Record<string, unknown> {
  const direct = new Set(paths.filter((p) => p.length === 1).map((p) => p[0]));
  const nested = new Map<string, string[][]>();
  for (const p of paths) {
    if (p.length > 1) {
      const arr = nested.get(p[0]!) ?? [];
      arr.push(p.slice(1));
      nested.set(p[0]!, arr);
    }
  }

  const out: Record<string, unknown> = {};
  if ("id" in doc) out.id = doc.id;
  for (const [k, v] of Object.entries(doc)) {
    if (k === "id") continue;
    if (mode === "exclude") {
      if (direct.has(k)) continue; // escondido por inteiro
      out[k] = nested.has(k) ? pruneNested(v, "exclude", nested.get(k)!) : v;
    } else {
      if (direct.has(k)) out[k] = v; // mantido por inteiro
      else if (nested.has(k)) out[k] = pruneNested(v, "include", nested.get(k)!);
      // else: não está na allowlist → some
    }
  }
  return out;
}

function pruneNested(v: unknown, mode: "include" | "exclude", tails: string[][]): unknown {
  if (Array.isArray(v)) return v.map((x) => pruneLevel(x as Record<string, unknown>, mode, tails));
  if (v && typeof v === "object") return pruneLevel(v as Record<string, unknown>, mode, tails);
  return v;
}
