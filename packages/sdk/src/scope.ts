import type { EntityIR, FieldIR } from "@mauroandre/weave-core";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";

// Scope-as-code: o dev escreve o scope por NOME (where Prisma-style + campos por
// nome), e o `pushScopes` converte pro formato de STORAGE (por field-id, rename-proof)
// e grava via `/admin/scopes`. Os conversores aqui são o inverso do enforcement
// (`scope.ts → resolveFilter`): WhereInput-por-nome → path-Filter-por-id.

export type Verb = "read" | "create" | "update" | "delete";

export interface ScopeEntityRule {
  verbs: Verb[];
  /** Filtro de linhas (WhereInput, por NOME; valores podem ser `{ param: "x" }`). */
  where?: Record<string, unknown>;
  /** Projeção: caminhos por NOME (dot-path, ex.: `"items.secret"`). */
  fields?: { include?: string[]; exclude?: string[] };
}

export interface ScopeDef {
  name: string;
  entities: Record<string, ScopeEntityRule>;
}

/** Helper tipado pro scope-as-code (igual `defineEntity`). */
export function defineScope(name: string, entities: Record<string, ScopeEntityRule>): ScopeDef {
  return { name, entities };
}

export interface PushScopesOptions {
  url: string;
  key: string;
  fetch?: FetchLike;
}

// ── conversores (por nome → por id) ───────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Caminho de nomes (dot-path) → caminho de field-ids, descendo owned/reference. */
function namePathToIds(entity: string, byName: Map<string, EntityIR>, dotPath: string): string[] {
  const ids: string[] = [];
  let fields = byName.get(entity)?.fields ?? {};
  const segs = dotPath.split(".");
  for (let i = 0; i < segs.length; i++) {
    const f = fields[segs[i]!];
    if (!f?.id) throw new Error(`scope: unknown field '${dotPath}' (em '${entity}').`);
    ids.push(f.id);
    if (i === segs.length - 1) break;
    if (f.kind === "owned") fields = f.shape ?? {};
    else if (f.kind === "reference") fields = byName.get(f.target)?.fields ?? {};
    else throw new Error(`scope: '${dotPath}' atravessa um escalar.`);
  }
  return ids;
}

/** Objeto de operador WhereInput → { op armazenado, value }. Inverso do `leafOp`. */
function decodeOp(val: Record<string, unknown>): { op: string; value?: unknown } {
  const ilikeUnwrap = (s: unknown): { op: string; value: unknown } => {
    if (typeof s === "string" && s.startsWith("%") && s.endsWith("%")) return { op: "contains", value: s.slice(1, -1) };
    if (typeof s === "string" && s.endsWith("%")) return { op: "startsWith", value: s.slice(0, -1) };
    return { op: "contains", value: s };
  };
  if ("ilike" in val) return ilikeUnwrap(val["ilike"]);
  if ("eq" in val) return { op: "equals", value: val["eq"] };
  if ("ne" in val) return { op: "notEquals", value: val["ne"] };
  if ("gt" in val) return { op: "gt", value: val["gt"] };
  if ("gte" in val) return { op: "gte", value: val["gte"] };
  if ("lt" in val) return { op: "lt", value: val["lt"] };
  if ("lte" in val) return { op: "lte", value: val["lte"] };
  if ("in" in val) return { op: "in", value: val["in"] };
  if ("notIn" in val) return { op: "notIn", value: val["notIn"] };
  if ("isNull" in val) return { op: "isEmpty" };
  return { op: "equals", value: undefined };
}

type ScopeFilter = unknown; // árvore path-based por-id (formato de storage)

/** WhereInput (por nome) → path-Filter (por id). Desce `some` em to-many. */
function whereToFilter(where: Record<string, unknown>, entity: string, byName: Map<string, EntityIR>): ScopeFilter {
  if (Array.isArray(where["and"])) {
    return { and: (where["and"] as Record<string, unknown>[]).map((w) => whereToFilter(w, entity, byName)) };
  }
  if (Array.isArray(where["or"])) {
    return { or: (where["or"] as Record<string, unknown>[]).map((w) => whereToFilter(w, entity, byName)) };
  }

  // Galho single-branch: desce até a folha (uma coluna), montando o id-path.
  const idPath: string[] = [];
  let cur: Record<string, unknown> = where;
  let fields = byName.get(entity)?.fields ?? {};
  for (let guard = 0; guard < 16; guard++) {
    const entry = Object.entries(cur)[0];
    if (!entry) break;
    const [key, val] = entry;
    const f: FieldIR | undefined = fields[key];
    if (!f?.id) throw new Error(`scope: campo '${key}' desconhecido em '${entity}'.`);
    idPath.push(f.id);

    if (f.kind === "column") {
      const opObj = f.array && isObj(val) && "some" in val ? (val["some"] as Record<string, unknown>) : (val as Record<string, unknown>);
      const { op, value } = decodeOp(opObj);
      return value === undefined ? { path: idPath, op } : { path: idPath, op, value };
    }
    // travessia: owned/reference. `some` (to-many) é desembrulhado.
    fields = f.kind === "owned" ? (f.shape ?? {}) : (byName.get(f.target)?.fields ?? {});
    cur = isObj(val) && "some" in val ? (val["some"] as Record<string, unknown>) : (val as Record<string, unknown>);
  }
  throw new Error(`scope: filtro inválido em '${entity}'.`);
}

/**
 * Empurra scopes-as-code: converte cada regra (where + fields por NOME) pro formato
 * por-id e grava via `PUT /admin/scopes/:name`. Busca os IRs das entidades pra
 * resolver os ids (rename-proof no storage).
 */
export async function pushScopes(
  scopes: Record<string, ScopeDef>,
  options: PushScopesOptions,
): Promise<{ pushed: string[] }> {
  const transport: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req));
  const base = options.url.replace(/\/$/, "");

  // IRs de todas as entidades (pra resolver nome→id).
  const listRes = await transport(
    new Request(`${base}/admin/entities`, { method: "GET", headers: { "x-api-key": options.key } }),
  );
  const listJson = (await listRes.json().catch(() => null)) as { entities?: EntityIR[]; error?: string } | null;
  if (!listRes.ok || !listJson?.entities) {
    throw errorFor(listRes.status, listJson?.error ?? "Failed to load entities for scope push.");
  }
  const byName = new Map(listJson.entities.map((e) => [e.name, e] as const));

  const pushed: string[] = [];
  for (const def of Object.values(scopes)) {
    const entities: Record<string, unknown> = {};
    for (const [entity, rule] of Object.entries(def.entities)) {
      const rows = rule.where ? whereToFilter(rule.where, entity, byName) : null;
      let fields: { mode: "include" | "exclude"; paths: string[][] } | null = null;
      if (rule.fields?.include) {
        fields = { mode: "include", paths: rule.fields.include.map((p) => namePathToIds(entity, byName, p)) };
      } else if (rule.fields?.exclude) {
        fields = { mode: "exclude", paths: rule.fields.exclude.map((p) => namePathToIds(entity, byName, p)) };
      }
      entities[entity] = { verbs: rule.verbs, rows, fields };
    }

    const res = await transport(
      new Request(`${base}/admin/scopes/${encodeURIComponent(def.name)}`, {
        method: "PUT",
        headers: { "x-api-key": options.key, "content-type": "application/json" },
        body: JSON.stringify({ name: def.name, entities }),
      }),
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw errorFor(res.status, j?.error ?? `Push scope '${def.name}' failed (${res.status}).`);
    }
    pushed.push(def.name);
  }
  return { pushed };
}
