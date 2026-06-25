import { weave } from "../index.js";
import { listEntities } from "./entities.js";
import { resolveMirrors } from "../ir/resolve-mirrors.js";
import { fromIR } from "../ir/from-ir.js";
import type { EntityIR, FieldIR } from "../ir/types.js";

export interface ObjectPage {
  root: string;
  /** Forma RESOLVIDA (mirrors expandidos) de toda entidade, p/ os cards recursivos. */
  shapes: Record<string, Record<string, FieldIR>>;
  docs: Record<string, unknown>[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

/** Lê uma página de objetos de uma entidade (owned aninhado + references expandidas 1 nível). */
export async function listObjects(name: string, page = 1, perPage = 20): Promise<ObjectPage> {
  const irs = await listEntities();
  const root = irs.find((e) => e.name === name);
  if (!root) throw new Error(`Unknown entity: ${name}`);

  const byName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, byName));
  const entities = fromIR(resolved);
  const shapes: Record<string, Record<string, FieldIR>> = {};
  for (const r of resolved) shapes[r.name] = r.fields;

  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  try {
    const expand = buildExpand(root);
    const opts: Record<string, unknown> = { page, perPage };
    if (Object.keys(expand).length) opts.expand = expand;
    // Chamado no próprio client (não extrair o método: perderia o `this`).
    const loose = client as unknown as {
      paginate(
        e: unknown,
        o: unknown,
      ): Promise<{ docs: unknown[]; docsQuantity: number; pageQuantity: number; currentPage: number }>;
    };
    const res = await loose.paginate(entities[name], opts);
    return jsonSafe({
      root: name,
      shapes,
      docs: res.docs as Record<string, unknown>[],
      docsQuantity: res.docsQuantity,
      pageQuantity: res.pageQuantity,
      currentPage: res.currentPage,
    });
  } finally {
    await client.close();
  }
}

// postgres.js devolve `int8` como BigInt, que o JSON.stringify da resposta RPC não
// serializa. Convertemos: número quando cabe com segurança, senão string.
function jsonSafe<T>(v: T): T {
  if (typeof v === "bigint") {
    return (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) as unknown as T;
  }
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x)) as unknown as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out as unknown as T;
  }
  return v;
}

/**
 * Cria/atualiza um objeto (escalares + owned). `references` são read-only no
 * editor; aqui só convertemos a forma expandida de volta pra id-form, pra o
 * `save` do engine **preservar** os vínculos (sobretudo N:N, que ele substitui).
 */
export async function saveObject(name: string, object: Record<string, unknown>): Promise<unknown> {
  const irs = await listEntities();
  const root = irs.find((e) => e.name === name);
  if (!root) throw new Error(`Unknown entity: ${name}`);
  const byName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, byName));
  const entities = fromIR(resolved);
  const shape = resolved.find((e) => e.name === name)!.fields;
  normalizeRefs(shape, object);

  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  try {
    const loose = client as unknown as { save(e: unknown, i: unknown): Promise<unknown> };
    return jsonSafe(await loose.save(entities[name], object));
  } finally {
    await client.close();
  }
}

/** Converte references expandidas (objeto/array do read) de volta pra id-form, recursivo. */
function normalizeRefs(fields: Record<string, FieldIR>, obj: Record<string, unknown> | null): void {
  if (!obj) return;
  for (const [name, node] of Object.entries(fields)) {
    if (node.kind === "reference") {
      const v = obj[name];
      if (node.cardinality === "one") {
        if (v && typeof v === "object") obj[`${name}Id`] = (v as { id?: unknown }).id;
      } else if (Array.isArray(v)) {
        obj[`${name}Ids`] = v.map((x) => (x as { id?: unknown })?.id).filter(Boolean);
      }
      delete obj[name];
    } else if (node.kind === "owned") {
      const v = obj[name];
      const childShape = node.shape ?? {};
      if (Array.isArray(v)) for (const c of v) normalizeRefs(childShape, c as Record<string, unknown>);
      else if (v && typeof v === "object") normalizeRefs(childShape, v as Record<string, unknown>);
    }
  }
}

/** Expande toda reference de topo (um nível), pra os dados do alvo aparecerem. */
function buildExpand(ir: EntityIR): Record<string, true> {
  const expand: Record<string, true> = {};
  for (const [name, node] of Object.entries(ir.fields)) {
    if (node.kind === "reference") expand[name] = true;
  }
  return expand;
}
