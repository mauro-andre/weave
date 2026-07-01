import type { EntityIR, FieldIR } from "../../core/src/index.js";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";

// Codegen: o estado do servidor (entidades + scopes, fonte da verdade) → source
// `.ts` legível e commitável. Inverso do `toIR`/`pushScopes`. Puro (sem fs) — o
// CLI escreve em disco. O `weave gen` reescreve a pasta `weave/` inteira a partir
// daqui (overwrite cego): arquivos de entidade (com `$id`), de scope, os barrels
// e o client configurado.

// ── Entidade: IR → defineEntity ────────────────────────────────────────────────

interface GenCtx {
  builders: Set<string>; // construtores/helpers usados (text, owned, reference, array…)
  imports: Set<string>; // entidades-alvo de reference (pra importar)
  mirror: boolean; // owned com mirror — o builder não tem `mirror()` (limitação)
  withId: boolean; // emitir `.$id(...)` (rename-safe) — ligado pelo `weave gen`
}

/** Expressão-base do campo (sem o `.$id`). */
function baseExpr(node: FieldIR, ctx: GenCtx, self: string): string {
  if (node.kind === "column") {
    ctx.builders.add(node.type);
    if (node.array) {
      ctx.builders.add("array");
      let s = `array(${node.type}())`;
      if (node.notNull === false) s += ".nullable()"; // arrays são notNull por padrão
      if (node.unique) s += ".unique()";
      if (node.index) s += ".index()";
      return s;
    }
    let s = `${node.type}()`;
    if (node.notNull) s += ".notNull()";
    if (node.unique) s += ".unique()";
    if (node.index) s += ".index()";
    if (node.default !== undefined) s += `.default(${JSON.stringify(node.default)})`;
    return s;
  }
  if (node.kind === "reference") {
    ctx.builders.add("reference");
    if (node.target !== self) ctx.imports.add(node.target);
    if (node.cardinality === "many") {
      ctx.builders.add("array");
      return `reference(array(${node.target}))`;
    }
    return `reference(${node.target})${node.notNull ? ".notNull()" : ""}`;
  }
  // owned
  if (node.mirror) ctx.mirror = true; // sem builder de mirror — gera o shape concreto (vazio se só mirror)
  ctx.builders.add("owned");
  const inner = shapeSource(node.shape ?? {}, ctx, self);
  return node.array ? `owned(array({ ${inner} }))` : `owned({ ${inner} })`;
}

function fieldSource(node: FieldIR, ctx: GenCtx, self: string): string {
  const base = baseExpr(node, ctx, self);
  const id = ctx.withId && node.id ? `.$id(${JSON.stringify(node.id)})` : "";
  return base + id;
}

function shapeSource(fields: Record<string, FieldIR>, ctx: GenCtx, self: string): string {
  return Object.entries(fields)
    .map(([k, n]) => `${k}: ${fieldSource(n, ctx, self)}`)
    .join(", ");
}

export interface IrToSourceOptions {
  /** Emitir `.$id(...)` em cada campo (estável, rename-safe). Default: false. */
  withId?: boolean;
}

/** Gera o source `export default defineEntity(...)` de UMA entidade (com imports). */
export function irToSource(ir: EntityIR, options: IrToSourceOptions = {}): string {
  const ctx: GenCtx = { builders: new Set(), imports: new Set(), mirror: false, withId: options.withId ?? false };
  const body = Object.entries(ir.fields)
    .map(([k, n]) => `  ${k}: ${fieldSource(n, ctx, ir.name)},`)
    .join("\n");

  const builders = ["defineEntity", ...[...ctx.builders].sort()];
  const lines = [`import { ${builders.join(", ")} } from "@mauroandre/weave-sdk";`];
  for (const t of [...ctx.imports].sort()) lines.push(`import ${t} from "./${t}.js";`);
  if (ctx.mirror) lines.push(`// ⚠ This entity uses a mirror — write/edit the shape by hand (the builder has no mirror()).`);
  lines.push("", `export default defineEntity(${JSON.stringify(ir.name)}, {`, body, `}${optsSource(ir)});`, "");
  return lines.join("\n");
}

/** O 3º arg de `defineEntity` (unique/index compostos), ou "" quando não houver. */
function optsSource(ir: EntityIR): string {
  const parts: string[] = [];
  if (ir.unique?.length) parts.push(`unique: ${JSON.stringify(ir.unique)}`);
  if (ir.index?.length) parts.push(`index: ${JSON.stringify(ir.index)}`);
  return parts.length ? `, { ${parts.join(", ")} }` : "";
}

// ── Scope: storage por-id → defineScope por-nome ───────────────────────────────
// Inverso do `pushScopes` (por-nome → por-id) e espelho do enforcement
// (`app/api/scope.ts`: conditionToWhere/leafOp).

interface StoredCondition {
  path: string[];
  op: string;
  value?: unknown;
}
type StoredFilter = StoredCondition | { and: StoredFilter[] } | { or: StoredFilter[] };
interface StoredProjection {
  mode: "include" | "exclude";
  paths: string[][];
}
interface StoredRule {
  verbs: string[];
  rows: StoredFilter | null;
  fields: StoredProjection | null;
}
interface StoredScope {
  name: string;
  entities: Record<string, StoredRule>;
}

/** Caminho de field-ids → caminho de nomes, descendo owned/reference. */
function idPathToNames(entity: string, byName: Map<string, EntityIR>, idPath: string[]): string[] {
  const names: string[] = [];
  let fields = byName.get(entity)?.fields ?? {};
  for (let i = 0; i < idPath.length; i++) {
    const entry = Object.entries(fields).find(([, f]) => f.id === idPath[i]);
    if (!entry) throw new Error(`scope gen: field id '${idPath[i]}' não encontrado em '${entity}'.`);
    const [name, f] = entry;
    names.push(name);
    if (i === idPath.length - 1) break;
    if (f.kind === "owned") fields = f.shape ?? {};
    else if (f.kind === "reference") fields = byName.get(f.target)?.fields ?? {};
    else throw new Error(`scope gen: caminho atravessa um escalar em '${entity}'.`);
  }
  return names;
}

/** Operador de storage → objeto de operador WhereInput (espelha `leafOp`). */
function opToWhere(op: string, value: unknown): Record<string, unknown> {
  const str = typeof value === "string";
  switch (op) {
    case "contains":
      return { ilike: str ? `%${value}%` : value };
    case "startsWith":
      return { ilike: str ? `${value}%` : value };
    case "equals":
    case "on":
      return { eq: value };
    case "notEquals":
      return { ne: value };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { [op]: value };
    case "before":
      return { lt: value };
    case "after":
      return { gt: value };
    case "in":
      return { in: value };
    case "notIn":
      return { notIn: value };
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

/** Nomes + op + valor → WhereInput aninhado (`some` em to-many) — espelha `conditionToWhere`. */
function buildWhere(
  entity: string,
  byName: Map<string, EntityIR>,
  names: string[],
  op: string,
  value: unknown,
): Record<string, unknown> {
  const rec = (fields: Record<string, FieldIR>, idx: number): Record<string, unknown> => {
    const seg = names[idx]!;
    const f = fields[seg];
    if (idx === names.length - 1) {
      const sc = opToWhere(op, value);
      const isArray = f?.kind === "column" && f.array === true;
      return { [seg]: isArray && op !== "isEmpty" ? { some: sc } : sc };
    }
    let next: Record<string, FieldIR> = {};
    let toMany = false;
    if (f?.kind === "owned") {
      next = f.shape ?? {};
      toMany = f.array === true;
    } else if (f?.kind === "reference") {
      next = byName.get(f.target)?.fields ?? {};
      toMany = f.cardinality === "many";
    }
    const inner = rec(next, idx + 1);
    return { [seg]: toMany ? { some: inner } : inner };
  };
  return rec(byName.get(entity)?.fields ?? {}, 0);
}

/** StoredFilter (por-id) → WhereInput (por-nome). */
function filterToWhere(filter: StoredFilter, entity: string, byName: Map<string, EntityIR>): Record<string, unknown> {
  if ("and" in filter) return { and: filter.and.map((f) => filterToWhere(f, entity, byName)) };
  if ("or" in filter) return { or: filter.or.map((f) => filterToWhere(f, entity, byName)) };
  const names = idPathToNames(entity, byName, filter.path);
  return buildWhere(entity, byName, names, filter.op, filter.value);
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Imprime um literal JS legível (chaves identifier sem aspas). */
function lit(value: unknown, indent = 0): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => lit(v, indent)).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const pad = "  ".repeat(indent + 1);
    const close = "  ".repeat(indent);
    const body = entries
      .map(([k, v]) => `${pad}${IDENT.test(k) ? k : JSON.stringify(k)}: ${lit(v, indent + 1)}`)
      .join(",\n");
    return `{\n${body},\n${close}}`;
  }
  return JSON.stringify(value);
}

/** Gera o source `export default defineScope(...)` de UM scope (resolve id→nome). */
export function scopeToSource(scope: StoredScope, byName: Map<string, EntityIR>): string {
  const rules: Record<string, unknown> = {};
  for (const [entity, rule] of Object.entries(scope.entities)) {
    const out: Record<string, unknown> = { verbs: rule.verbs };
    if (rule.rows) out["where"] = filterToWhere(rule.rows, entity, byName);
    if (rule.fields) {
      const paths = rule.fields.paths.map((p) => idPathToNames(entity, byName, p).join("."));
      out["fields"] = rule.fields.mode === "include" ? { include: paths } : { exclude: paths };
    }
    rules[entity] = out;
  }
  return [
    `import { defineScope } from "@mauroandre/weave-sdk";`,
    "",
    `export default defineScope(${JSON.stringify(scope.name)}, ${lit(rules)});`,
    "",
  ].join("\n");
}

// ── Barrels + client ───────────────────────────────────────────────────────────

/** Barrel de re-exports nomeados (autocomplete por nome). */
function barrelSource(names: string[]): string {
  return [
    `// GENERATED by \`weave gen\` — do not edit by hand.`,
    ...names.map((n) => `export { default as ${n} } from "./${n}.js";`),
    "",
  ].join("\n");
}

/** Client configurado (`weave/index.ts`) — lê WEAVE_URL/WEAVE_KEY do ambiente. */
function clientSource(): string {
  return [
    `// GENERATED by \`weave gen\` — do not edit by hand. Server-side use only (the key is a secret).`,
    `import { createClient } from "@mauroandre/weave-sdk";`,
    `import * as entities from "./entities/index.js";`,
    "",
    `export const weave = createClient({`,
    `  url: process.env.WEAVE_URL!,`,
    `  key: process.env.WEAVE_KEY!,`,
    `  entities,`,
    `});`,
    "",
  ].join("\n");
}

// ── Orquestrador ───────────────────────────────────────────────────────────────

export interface GenOptions {
  url: string;
  key: string;
  fetch?: FetchLike;
}

export interface GenProject {
  /** Caminho relativo (dentro da pasta `weave/`) → conteúdo. */
  files: Record<string, string>;
  entities: string[];
  scopes: string[];
}

async function fetchJson<T>(transport: FetchLike, url: string, key: string, what: string): Promise<T> {
  const res = await transport(new Request(url, { method: "GET", headers: { "x-api-key": key } }));
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw errorFor(res.status, json?.error ?? `Failed to load ${what}.`);
  return json;
}

/**
 * Busca o estado do servidor (entidades + scopes) e gera a árvore de arquivos da
 * pasta `weave/`: `entities/<name>.ts` (com `$id`) + barrel, `scopes/<name>.ts` +
 * barrel, e `index.ts` (client). O CLI limpa a pasta e escreve isto.
 */
export async function genProject(options: GenOptions): Promise<GenProject> {
  const transport: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req));
  const base = options.url.replace(/\/$/, "");

  const ents = await fetchJson<{ entities: EntityIR[] }>(transport, `${base}/admin/entities`, options.key, "entities");
  const scps = await fetchJson<{ scopes: StoredScope[] }>(transport, `${base}/admin/scopes`, options.key, "scopes");

  const byName = new Map(ents.entities.map((e) => [e.name, e] as const));
  const files: Record<string, string> = {};

  const entityNames: string[] = [];
  for (const ir of ents.entities) {
    files[`entities/${ir.name}.ts`] = irToSource(ir, { withId: true });
    entityNames.push(ir.name);
  }
  entityNames.sort();
  files["entities/index.ts"] = barrelSource(entityNames);

  const scopeNames: string[] = [];
  for (const s of scps.scopes) {
    // Um scope que referencia um campo inexistente (ex.: deletado) não derruba o
    // gen inteiro — é pulado. O resto da pasta regenera normalmente.
    try {
      files[`scopes/${s.name}.ts`] = scopeToSource(s, byName);
      scopeNames.push(s.name);
    } catch {
      /* scope órfão — pulado */
    }
  }
  scopeNames.sort();
  files["scopes/index.ts"] = barrelSource(scopeNames);

  files["index.ts"] = clientSource();

  return { files, entities: entityNames, scopes: scopeNames };
}

// ── Legado (pull) — mantido pra compat; `gen` é o caminho principal agora ───────

export interface PullOptions {
  url: string;
  key: string;
  fetch?: FetchLike;
}

/** Puxa os IRs remotos e gera o source de cada entidade. Devolve `nome.ts → conteúdo`. */
export async function pullEntities(options: PullOptions): Promise<{ files: Record<string, string>; names: string[] }> {
  const transport: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req));
  const base = options.url.replace(/\/$/, "");
  const json = await fetchJson<{ entities: EntityIR[] }>(transport, `${base}/admin/entities`, options.key, "entities");

  const files: Record<string, string> = {};
  const names: string[] = [];
  for (const ir of json.entities) {
    files[`${ir.name}.ts`] = irToSource(ir);
    names.push(ir.name);
  }
  return { files, names: names.sort() };
}
