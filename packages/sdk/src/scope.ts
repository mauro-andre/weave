import type { EntityIR, FieldIR, Entity, ShapeRecord, ScopeWhereInput, FieldPath, ExtractParams } from "../../core/src/index.js";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";

// Scope-as-code: o dev escreve o scope amarrando cada regra a uma ENTITY (por
// referência, `scopeRule(entity, …)`) — o binding sai do objeto, não de uma string
// solta (mata typo/casing/snake_case na origem). O `pushScopes` converte pro formato
// de STORAGE (por field-id, rename-proof) e grava via `/admin/scopes`. Os conversores
// aqui são o inverso do enforcement (`scope.ts → resolveFilter`): WhereInput-por-nome
// → path-Filter-por-id.

export type Verb = "read" | "create" | "update" | "delete";

/** Config de uma regra (sem a entity — ela vem por referência no `scopeRule`), TIPADA
 *  contra a entity `E`: `where` é um `WhereInput<E>` param-aware, `fields` são dot-paths
 *  de `E`. Typo/rename num campo/path viram erro de compilação, nunca falha silenciosa. */
export interface ScopeRuleConfig<E extends Entity<string, ShapeRecord> = Entity<string, ShapeRecord>> {
  verbs: readonly Verb[];
  /** Filtro de linhas: `WhereInput<E>` onde qualquer folha aceita `{ param: "x" }`. */
  where?: ScopeWhereInput<E>;
  /** Projeção: dot-paths de `E` (`"whatsapp"`, `"summaryForTheManager.expectedRoi"`). */
  fields?: { include?: FieldPath<E>[]; exclude?: FieldPath<E>[] };
}

/** Uma regra já resolvida (type-erased): o nome LÓGICO da entity (`entity.name`) + a
 *  config frouxa. `Params` é um phantom com os nomes de param inferidos do `where`. */
export interface ScopeRule<Params extends string = string> {
  entity: string;
  verbs: Verb[];
  where?: Record<string, unknown>;
  fields?: { include?: string[]; exclude?: string[] };
  /** @internal phantom — nomes de param (`{ param: "x" }`) inferidos do `where`. */
  readonly __params?: Params;
}

/** Nomes de param no `where` de uma config (vazio quando não há `where`). */
type WhereParams<C> = C extends { where: infer W } ? ExtractParams<W> : never;

export interface ScopeEntityRule {
  verbs: Verb[];
  where?: Record<string, unknown>;
  fields?: { include?: string[]; exclude?: string[] };
}

/** `Params` = union dos nomes de param inferidos das regras — o `weave.as` tipa contra isso. */
export interface ScopeDef<Params extends string = never> {
  name: string;
  entities: Record<string, ScopeEntityRule>;
  /** @internal phantom — carrega os nomes de param pro `weave.as`. */
  readonly __params?: Params;
}

/**
 * Amarra uma regra a uma ENTITY por referência. O binding sai de `entity.name` (o nome
 * LÓGICO canônico — camelCase como você escreveu no `defineEntity`), não de uma string —
 * então typo/casing/snake_case não existem aqui. Espelha o `reference(entity)`. O `const`
 * na config preserva os literais dos `{ param: "x" }` pra inferência (Pedido 2d).
 */
export function scopeRule<E extends Entity<string, ShapeRecord>, const C>(
  entity: E,
  config: C & ScopeRuleConfig<E>,
): ScopeRule<WhereParams<C>> {
  return {
    entity: entity.name,
    verbs: [...config.verbs],
    ...(config.where ? { where: config.where as Record<string, unknown> } : {}),
    ...(config.fields ? { fields: config.fields as { include?: string[]; exclude?: string[] } } : {}),
  };
}

/** Union dos params de todas as regras de um scope. */
type RulesParams<R extends readonly ScopeRule[]> = NonNullable<R[number]["__params"]>;

/**
 * Helper pro scope-as-code (igual `defineEntity`): nome + regras amarradas por `scopeRule`.
 * Devolve `ScopeDef<Params>` com os nomes de param INFERIDOS das regras — o `weave.as`
 * usa isso pra tipar (e exigir) o objeto de params na chamada, sem você declarar nada.
 */
export function defineScope<const R extends readonly ScopeRule[]>(
  name: string,
  rules: R,
): ScopeDef<RulesParams<R>> {
  const entities: Record<string, ScopeEntityRule> = {};
  for (const r of rules) {
    if (entities[r.entity]) throw new Error(`scope '${name}': regra duplicada para a entity '${r.entity}'.`);
    entities[r.entity] = {
      verbs: r.verbs,
      ...(r.where ? { where: r.where } : {}),
      ...(r.fields ? { fields: r.fields } : {}),
    };
  }
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

/**
 * Operator object → { stored op, value }. Inverse of `leafOp`. A **bare value** — a
 * primitive, `null`, or a `{ param }` wrapper (no operator key) — means `eq`, 1:1 with
 * the query's shorthand (`{ active: true }` ≡ `{ active: { eq: true } }`; `null` → isNull).
 */
function decodeOp(val: unknown): { op: string; value?: unknown } {
  if (val === null) return { op: "isEmpty" };
  if (typeof val !== "object") return { op: "equals", value: val };
  const v = val as Record<string, unknown>;
  const ilikeUnwrap = (s: unknown): { op: string; value: unknown } => {
    if (typeof s === "string" && s.startsWith("%") && s.endsWith("%")) return { op: "contains", value: s.slice(1, -1) };
    if (typeof s === "string" && s.endsWith("%")) return { op: "startsWith", value: s.slice(0, -1) };
    return { op: "contains", value: s };
  };
  if ("ilike" in v) return ilikeUnwrap(v["ilike"]);
  if ("eq" in v) return { op: "equals", value: v["eq"] };
  if ("ne" in v) return { op: "notEquals", value: v["ne"] };
  if ("gt" in v) return { op: "gt", value: v["gt"] };
  if ("gte" in v) return { op: "gte", value: v["gte"] };
  if ("lt" in v) return { op: "lt", value: v["lt"] };
  if ("lte" in v) return { op: "lte", value: v["lte"] };
  if ("in" in v) return { op: "in", value: v["in"] };
  if ("notIn" in v) return { op: "notIn", value: v["notIn"] };
  if ("isNull" in v) return { op: "isEmpty" };
  // No known operator key (e.g. `{ param: "x" }`) → treat the whole object as a bare eq value.
  return { op: "equals", value: v };
}

type StoredCond = { path: string[]; op: string; value?: unknown };
type ScopeFilter = StoredCond | { and: ScopeFilter[] } | { or: ScopeFilter[] };

/** Prepend a field-id to every leaf path in a subtree — used when descending an owned/ref hop. */
function prefixPath(id: string, filter: ScopeFilter): ScopeFilter {
  if ("and" in filter) return { and: filter.and.map((f) => prefixPath(id, f)) };
  if ("or" in filter) return { or: filter.or.map((f) => prefixPath(id, f)) };
  return { ...filter, path: [id, ...filter.path] };
}

/**
 * WhereInput (por nome) → path-Filter (por id), sobre um mapa de campos. **TODA chave
 * num nível é um AND implícito** e vira uma condição própria — nada é DROPADO. (Dropar
 * condição num filtro de acesso = filtro mais permissivo = furo de autorização; era o
 * bug do `Object.entries(cur)[0]`.) `and`/`or` são combinadores; owned/reference descem
 * recursivamente (com `some` desembrulhado no to-many) e recebem o field-id no prefixo.
 */
function whereFieldsToFilter(
  where: Record<string, unknown>,
  fields: Record<string, FieldIR>,
  byName: Map<string, EntityIR>,
): ScopeFilter {
  const conds: ScopeFilter[] = [];
  for (const key of Object.keys(where)) {
    const val = where[key];
    if (key === "and" && Array.isArray(val)) {
      conds.push({ and: (val as Record<string, unknown>[]).map((w) => whereFieldsToFilter(w, fields, byName)) });
      continue;
    }
    if (key === "or" && Array.isArray(val)) {
      conds.push({ or: (val as Record<string, unknown>[]).map((w) => whereFieldsToFilter(w, fields, byName)) });
      continue;
    }
    if (key === "not") throw new Error("scope: `not` não é suportado no where de um scope.");
    const f = fields[key];
    if (!f?.id) throw new Error(`scope: campo '${key}' desconhecido.`);
    if (f.kind === "column") {
      const opObj = f.array && isObj(val) && "some" in val ? (val["some"] as Record<string, unknown>) : val;
      const { op, value } = decodeOp(opObj);
      conds.push(value === undefined ? { path: [f.id], op } : { path: [f.id], op, value });
      continue;
    }
    // travessia owned/reference: desce (desembrulha `some` no to-many) e prefixa o id.
    const nested = (isObj(val) && "some" in val ? val["some"] : val) as Record<string, unknown>;
    const targetFields = f.kind === "owned" ? (f.shape ?? {}) : (byName.get(f.target)?.fields ?? {});
    conds.push(prefixPath(f.id, whereFieldsToFilter(nested, targetFields, byName)));
  }
  if (conds.length === 0) throw new Error("scope: filtro vazio.");
  return conds.length === 1 ? conds[0]! : { and: conds };
}

/** WhereInput (por nome) → path-Filter (por id) na raiz da entity. */
function whereToFilter(where: Record<string, unknown>, entity: string, byName: Map<string, EntityIR>): ScopeFilter {
  return whereFieldsToFilter(where, byName.get(entity)?.fields ?? {}, byName);
}

/**
 * Empurra scopes-as-code: converte cada regra (where + fields por NOME) pro formato
 * por-id e grava via `PUT /admin/scopes/:name`. Busca os IRs das entidades pra
 * resolver os ids (rename-proof no storage).
 */
export async function pushScopes(
  scopes: Record<string, ScopeDef<string>>,
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
