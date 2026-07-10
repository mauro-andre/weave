import { weave, compileCount, compileAggregate, compileAccumulate } from "../index.js";
import { db } from "./db.js";
import { listEntities } from "./entities.js";
import { maintainPartitions } from "./partition.js";
import { parseDuration } from "../ddl/partition.js";
import { resolveMirrors, fromIR, tableize, camelize, type EntityIR, type FieldIR, type AccumulateOp } from "@mauroandre/weave-core";

type SqlUnsafe = { unsafe(q: string, p?: unknown[]): Promise<unknown[]> };

// `where`/`orderBy` chegam como JSON tipado (WhereInput/OrderByInput) do SDK/API/GUI;
// aqui tratamos como mapas frouxos e repassamos pro engine (compileFind/compileCount).
type WhereArg = Record<string, unknown>;
type OrderArg = Record<string, unknown>;

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
  where?: WhereArg | null,
  orderBy?: OrderArg | null,
  expand?: ExpandSpec | null,
  latestPer?: string[] | null,
  select?: SelectSpec | null,
): Promise<ObjectPage> {
  name = tableize(name); // camelCase do SDK → nome de tabela guardado
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);

  const rawByName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, rawByName));
  const entities = fromIR(resolved);
  const shapes: Record<string, Record<string, FieldIR>> = {};
  for (const r of resolved) shapes[r.name] = r.fields;
  const rootIr = resolved.find((e) => e.name === name)!;

  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  const sql = (client as unknown as { sql: { unsafe(q: string, p?: unknown[]): Promise<unknown[]> } }).sql;
  const find = (client as unknown as { find(e: unknown, o: unknown): Promise<Record<string, unknown>[]> }).find.bind(
    client,
  );
  const count = compileCount as unknown as (e: unknown, w: unknown, lp?: string[]) => {
    text: string;
    params: unknown[];
  };
  try {
    const p = Math.max(1, Math.floor(page));
    const pp = Math.max(1, Math.floor(perPage));
    const offset = (p - 1) * pp;
    const entity = entities[name];
    const w = where ?? {};
    const lp = latestPer && latestPer.length ? latestPer : undefined;

    const countQ = count(entity, w, lp);
    const countRows = (await sql.unsafe(countQ.text, countQ.params)) as { n: number }[];
    const docsQuantity = countRows[0]?.n ?? 0;

    const ob = { ...(orderBy ?? {}), id: "asc" }; // `id` desempate estável da paginação
    const opts: Record<string, unknown> = { where: w, orderBy: ob, limit: pp, offset };
    if (select && Object.keys(select).length) {
      // `select` = whitelist de leitura enxuta (subsume o expand): só hidrata o nomeado,
      // sem auto-expand. Pro caso de lista de entity profunda (não puxa os owned que a
      // tela não mostra). Ausente = comportamento de sempre (owned cheio + auto-expand).
      opts.select = select;
    } else {
      // expand explícito (SDK/API) tem precedência; ausente (GUI sem param) = auto 1 nível.
      const expandMap = expand == null ? buildExpand(rootIr.fields) : expand;
      if (Object.keys(expandMap).length) opts.expand = expandMap;
    }
    if (lp) opts.latestPer = lp;
    const docs = await find(entity, opts);

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

/**
 * Roda um `aggregate` (groupBy + acumuladores + orderBy) e devolve as linhas
 * agrupadas. `input` é o AggregateInput frouxo (JSON do SDK/API), já com o `where`
 * do scope AND-ado pelo handler. O `jsonSafe` normaliza o bigint do `count`.
 */
export interface AggregateResult {
  rows: Record<string, unknown>[];
  /** Um array de linhas por faceta (breakdown). `{}` quando não há facets. */
  facets: Record<string, Record<string, unknown>[]>;
}

export async function aggregateObjects(name: string, input: Record<string, unknown>): Promise<AggregateResult> {
  name = tableize(name);
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);
  const byName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, byName));
  const entities = fromIR(resolved);
  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  const sql = (client as unknown as { sql: { unsafe(q: string, p?: unknown[]): Promise<unknown[]> } }).sql;
  const agg = compileAggregate as unknown as (e: unknown, i: unknown) => { text: string; params: unknown[] };
  // Uma query = uma agregação. compileAggregate ignora `facets` (só o main lê); cada
  // faceta roda como outro aggregate herdando o `where` do pai (limit → perPage).
  const runOne = async (inp: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
    const q = agg(entities[name], inp);
    return jsonSafe(await sql.unsafe(q.text, q.params)) as Record<string, unknown>[];
  };
  try {
    const rows = await runOne(input);
    const facets: Record<string, Record<string, unknown>[]> = {};
    const spec = (input.facets ?? {}) as Record<string, Record<string, unknown>>;
    for (const [fname, f] of Object.entries(spec)) {
      const { limit, ...rest } = f;
      facets[fname] = await runOne({ ...rest, where: input.where, perPage: limit });
    }
    return { rows, facets };
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
  name = tableize(name);
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
  const sql = (client as unknown as { sql: SqlUnsafe }).sql;
  try {
    // Create único numa entity particionada: garante a partição da `ts` da linha. Ao
    // contrário do ingest em lote (pula silencioso + loga), um create explícito além da
    // retenção é um erro claro — a partição já não existe.
    if (root.partitionBy) {
      const { field, interval } = root.partitionBy;
      const retentionSec = root.retention ? parseDuration(root.retention) : null;
      const { keep } = await maintainPartitions(sql, name, parseDuration(interval), retentionSec, [
        tsEpoch(object[field], field, name),
      ]);
      if (!keep[0]) {
        throw new Error(`weave: this row's '${field}' is older than the retention window (${root.retention}).`);
      }
    }
    const loose = client as unknown as { save(e: unknown, i: unknown): Promise<unknown> };
    return jsonSafe(await loose.save(entities[name], object));
  } finally {
    await client.close();
  }
}

/**
 * Cria muitos objetos numa transação (ingest em lote). Normaliza refs de cada
 * input igual ao `saveObject` e delega ao `createMany` do engine; devolve as
 * linhas criadas na ordem de entrada.
 */
export async function createManyObjects(
  name: string,
  inputs: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  name = tableize(name);
  const irs = await listEntities();
  const root = irs.find((e) => e.name === name);
  if (!root) throw new Error(`Unknown entity: ${name}`);
  const byName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, byName));
  const entities = fromIR(resolved);
  const shape = resolved.find((e) => e.name === name)!.fields;
  for (const input of inputs) normalizeRefs(shape, input);

  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  const sql = (client as unknown as { sql: SqlUnsafe }).sql;
  try {
    const toInsert = await applyPartitioning(sql, root, name, inputs);
    if (toInsert.length === 0) return [];
    const loose = client as unknown as { createMany(e: unknown, i: unknown[]): Promise<unknown[]> };
    return jsonSafe(await loose.createMany(entities[name], toInsert)) as Record<string, unknown>[];
  } finally {
    await client.close();
  }
}

/**
 * Accumulate (tier histórico): faz um upsert mergeável na `key` (o unique declarado),
 * aplicando `ops` (inc/max/min/setOnInsert) NO POSTGRES, e devolve a linha resultante
 * (Decisão 1 — inc-and-return). Não passa pelo `save` do engine (nada de shred/owned):
 * é uma tabela de rollup plana, então compila direto no upsert e roda numa query.
 */
export async function accumulateObject(
  name: string,
  key: Record<string, unknown>,
  ops: Record<string, AccumulateOp>,
): Promise<Record<string, unknown>> {
  name = tableize(name);
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);
  const byName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, byName));
  const entities = fromIR(resolved);

  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  const sql = (client as unknown as { sql: { unsafe(q: string, p?: unknown[]): Promise<unknown[]> } }).sql;
  try {
    const q = compileAccumulate(entities[name]!, key, ops);
    const rows = (await sql.unsafe(q.text, q.params)) as Record<string, unknown>[];
    // `RETURNING *` volta com chaves snake_case (colunas cruas); o resto da API fala
    // camelCase (o SDK revive por lá). Remapeia pra alinhar (rollup é plano: sem owned).
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rows[0] ?? {})) out[camelize(k)] = v;
    return jsonSafe(out);
  } finally {
    await client.close();
  }
}

/**
 * Manutenção de partição no ingest em lote de uma entity particionada: garante as
 * partições das linhas que chegam, dropa expiradas e PULA as que caem além da retenção
 * (a partição já não existe; guardá-las seria criar-pra-dropar). Devolve o que inserir
 * e loga o nº pulado — observável (diagnóstico de relógio de worker torto).
 */
async function applyPartitioning(
  sql: SqlUnsafe,
  root: EntityIR,
  table: string,
  inputs: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (!root.partitionBy) return inputs;
  const { field, interval } = root.partitionBy;
  const intervalSec = parseDuration(interval);
  const retentionSec = root.retention ? parseDuration(root.retention) : null;
  const tsEpochs = inputs.map((i) => tsEpoch(i[field], field, table));
  const { keep, skipped } = await maintainPartitions(sql, table, intervalSec, retentionSec, tsEpochs);
  if (skipped > 0) {
    console.warn(
      `weave: partition retention on '${table}' skipped ${skipped} row(s) with '${field}' older than ${root.retention}.`,
    );
  }
  return inputs.filter((_, i) => keep[i]);
}

/** Epoch (seg) do campo de partição de um input; erro claro se ausente/inválido. */
function tsEpoch(v: unknown, field: string, table: string): number {
  const ms =
    v instanceof Date ? v.getTime() : typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
  if (!Number.isFinite(ms)) {
    throw new Error(`weave: '${table}' is partitioned by '${field}' — every row needs a valid timestamp there.`);
  }
  return ms / 1000;
}

/** Converte references expandidas (objeto/array do read) de volta pra id-form, recursivo. */
function normalizeRefs(fields: Record<string, FieldIR>, obj: Record<string, unknown> | null): void {
  if (!obj) return;
  for (const [name, node] of Object.entries(fields)) {
    if (node.kind === "reference") {
      const v = obj[name];
      if (node.cardinality === "one") {
        // O FK EXPLÍCITO (`<field>Id`, ex.: o patch de updateOne) tem precedência sobre a
        // reference expandida — o objeto `<field>` só vem de um read (refs são read-only na
        // edição). Derivar dele só quando NÃO há `<field>Id`; senão trocar/limpar um FK que
        // já tem valor virava no-op silencioso (o objeto antigo re-derivava o id velho).
        if (v && typeof v === "object" && obj[`${name}Id`] === undefined) obj[`${name}Id`] = (v as { id?: unknown }).id;
      } else if (Array.isArray(v) && obj[`${name}Ids`] === undefined) {
        // Mesma precedência do N:1: `<field>Ids` EXPLÍCITO (patch de updateOne) vence a
        // reference expandida. Só derivar do array quando o patch NÃO passou `<field>Ids`
        // — senão trocar/limpar o set N:N virava no-op (o array antigo re-derivava os ids
        // velhos, sobrescrevendo o patch). `[]` explícito é respeitado → limpa a junção.
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
  const page = await listObjects(name, 1, 1, { id: { eq: id } });
  return page.docs[0] ?? null;
}

/**
 * Apaga um objeto pela id. Owned (e links N:N) cascateiam via FK; se o objeto
 * for **referenciado** por outro (N:1), o Postgres barra — devolvemos mensagem
 * amigável (nunca o erro SQL cru).
 */
export async function deleteObject(name: string, id: string): Promise<void> {
  name = tableize(name);
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);
  const sql = db();
  try {
    await sql`DELETE FROM ${sql(name)} WHERE id = ${id}`;
  } catch (e) {
    if ((e as { code?: string }).code === "23503") {
      throw new Error("Can't delete: this object is referenced by other objects.");
    }
    throw e;
  }
}

/**
 * Apaga TODOS os objetos de uma entidade (esvazia a tabela). Owned/links N:N
 * cascateiam via FK; se algum objeto for **referenciado** por outra entidade (N:1),
 * o Postgres barra e devolvemos mensagem amigável. Devolve quantos foram apagados.
 */
export async function deleteAllObjects(name: string): Promise<number> {
  name = tableize(name);
  const irs = await listEntities();
  if (!irs.some((e) => e.name === name)) throw new Error(`Unknown entity: ${name}`);
  const sql = db();
  try {
    const res = await sql`DELETE FROM ${sql(name)}`;
    return res.count ?? 0;
  } catch (e) {
    if ((e as { code?: string }).code === "23503") {
      throw new Error("Can't delete all: some objects are referenced by other entities.");
    }
    throw e;
  }
}

/** Mapa de expand recursivo: references em TODO nível (topo e dentro de owned). */
export type ExpandSpec = { [field: string]: true | ExpandSpec };

/** Mapa de select recursivo (whitelist): campo → `true` (subárvore inteira) | submapa. */
export type SelectSpec = { [field: string]: true | SelectSpec };

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
