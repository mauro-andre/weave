import type { Context } from "hono";
import type { Filter } from "../engine/control-plane/filter.js";
import type { Verb } from "../engine/control-plane/scopes.js";
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

/**
 * Resolve o acesso da requisição p/ (entidade, verbo). Sem header `x-weave-scope`
 * → god (a key é o segredo confiável). Com scope: checa verbo, resolve o filtro de
 * linhas (id→nome + params do header) e a projeção (id→nome). Lança ScopeError.
 */
export async function resolveAccess(c: Context, entity: string, verb: Verb): Promise<Access> {
  const scopeName = c.req.header("x-weave-scope");
  if (!scopeName) return { god: true, rows: null, projection: null };

  const { getScope } = await import("../engine/control-plane/scopes.js");
  const scope = await getScope(scopeName);
  if (!scope) throw new ScopeError(`Unknown scope '${scopeName}'.`, 403);
  const rule = scope.entities[entity];
  if (!rule) throw new ScopeError(`Scope '${scopeName}' has no access to '${entity}'.`, 403);
  if (!rule.verbs.includes(verb)) throw new ScopeError(`Scope '${scopeName}' can't ${verb} '${entity}'.`, 403);

  const byName = await resolvedShapes();
  const params = parseParams(c.req.header("x-weave-params"));
  const rows = rule.rows ? resolveFilter(entity, byName, rule.rows, params) : null;
  const projection = rule.fields
    ? { mode: rule.fields.mode, paths: resolvePaths(entity, byName, rule.fields.paths) }
    : null;
  return { god: false, rows, projection };
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
async function resolvedShapes(): Promise<Map<string, EntityIR>> {
  const { listEntities } = await import("../engine/control-plane/entities.js");
  const { resolveMirrors } = await import("@mauroandre/weave-core");
  const irs = await listEntities();
  const raw = new Map(irs.map((e) => [e.name, e] as const));
  return new Map(irs.map((e) => [e.name, resolveMirrors(e, raw)] as const));
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
