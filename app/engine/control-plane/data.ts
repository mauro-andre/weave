import { weave } from "../index.js";
import { db } from "./db.js";
import { listEntities } from "./entities.js";
import { resolveMirrors, fromIR, slug, type FieldIR } from "@mauroandre/weave-core";
import { compileFilter, type Filter } from "./filter.js";
import { compileSort, type SortKey } from "./sort.js";

export interface ObjectPage {
  root: string;
  /** Forma RESOLVIDA (mirrors expandidos) de toda entidade, p/ os cards recursivos. */
  shapes: Record<string, Record<string, FieldIR>>;
  docs: Record<string, unknown>[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

/**
 * Lê uma página de objetos (owned aninhado + references expandidas 1 nível),
 * com filtro por caminho aninhado opcional. Estratégia: o filtro compila num
 * predicado `EXISTS` sobre a tabela raiz, que produz os ids da página (count +
 * limit/offset); depois o engine lê/expande esses ids — sem tocar no read.
 */
export async function listObjects(
  name: string,
  page = 1,
  perPage = 20,
  filter?: Filter | null,
  sort?: SortKey[] | null,
): Promise<ObjectPage> {
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);

  const rawByName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, rawByName));
  const byName = new Map(resolved.map((e) => [e.name, e] as const)); // resolvido, p/ o filtro
  const entities = fromIR(resolved);
  const shapes: Record<string, Record<string, FieldIR>> = {};
  for (const r of resolved) shapes[r.name] = r.fields;
  const rootIr = byName.get(name)!;
  const table = slug(name);

  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  const sql = (client as unknown as { sql: { unsafe(q: string, p?: unknown[]): Promise<unknown[]> } }).sql;
  const find = (client as unknown as { find(e: unknown, o: unknown): Promise<Record<string, unknown>[]> }).find.bind(
    client,
  );
  try {
    let where = "";
    let params: unknown[] = [];
    if (filter) {
      const compiled = compileFilter(name, rootIr.fields, byName, filter);
      where = `WHERE ${compiled.sql}`;
      params = compiled.params;
    }

    const p = Math.max(1, Math.floor(page));
    const pp = Math.max(1, Math.floor(perPage));
    const offset = (p - 1) * pp;

    const countRows = (await sql.unsafe(`SELECT count(*)::int AS n FROM ${table} root ${where}`, params)) as {
      n: number;
    }[];
    const docsQuantity = countRows[0]?.n ?? 0;

    // `id` (uuidv7) entra sempre como desempate estável da paginação.
    const orderBy =
      sort && sort.length > 0 ? `${compileSort(name, rootIr.fields, byName, sort)}, root.id` : "root.id";
    const idRows = (await sql.unsafe(
      `SELECT id FROM ${table} root ${where} ORDER BY ${orderBy} LIMIT ${pp} OFFSET ${offset}`,
      params,
    )) as { id: string }[];
    const ids = idRows.map((r) => r.id);

    let docs: Record<string, unknown>[] = [];
    if (ids.length > 0) {
      const expand = buildExpand(rootIr.fields);
      const opts: Record<string, unknown> = { where: { id: { in: ids } } };
      if (Object.keys(expand).length) opts.expand = expand;
      const found = await find(entities[name], opts);
      const byId = new Map(found.map((d) => [d.id as string, d]));
      docs = ids.map((id) => byId.get(id)).filter((d): d is Record<string, unknown> => !!d);
    }

    return jsonSafe({
      root: name,
      shapes,
      docs,
      docsQuantity,
      pageQuantity: Math.max(1, Math.ceil(docsQuantity / pp)),
      currentPage: p,
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

/** Lê um objeto pela id (owned aninhado + references expandidas), ou null. */
export async function getObject(name: string, id: string): Promise<Record<string, unknown> | null> {
  const page = await listObjects(name, 1, 1, { path: ["id"], op: "equals", value: id });
  return page.docs[0] ?? null;
}

/**
 * Apaga um objeto pela id. Owned (e links N:N) cascateiam via FK; se o objeto
 * for **referenciado** por outro (N:1), o Postgres barra — devolvemos mensagem
 * amigável (nunca o erro SQL cru).
 */
export async function deleteObject(name: string, id: string): Promise<void> {
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);
  const sql = db();
  try {
    await sql`DELETE FROM ${sql(slug(name))} WHERE id = ${id}`;
  } catch (e) {
    if ((e as { code?: string }).code === "23503") {
      throw new Error("Can't delete: this object is referenced by other objects.");
    }
    throw e;
  }
}

/** Mapa de expand recursivo: references em TODO nível (topo e dentro de owned). */
type ExpandSpec = { [field: string]: true | ExpandSpec };

/**
 * Expande references um nível, em qualquer profundidade de `owned`. Reference de
 * topo vira `{ ref: true }`; reference DENTRO de um owned vira `{ owned: { ref:
 * true } }` — o engine repassa esse mapa pro filho. Sem isso, uma reference
 * aninhada (ex.: o `category` de um item espelhado) voltava como `categoryId`
 * cru, nunca expandida.
 */
function buildExpand(fields: Record<string, FieldIR>): ExpandSpec {
  const expand: ExpandSpec = {};
  for (const [name, node] of Object.entries(fields)) {
    if (node.kind === "reference") {
      expand[name] = true;
    } else if (node.kind === "owned") {
      const nested = buildExpand(node.shape ?? {});
      if (Object.keys(nested).length) expand[name] = nested;
    }
  }
  return expand;
}
