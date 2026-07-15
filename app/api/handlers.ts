import type { EndpointHandlerArgs } from "@mauroandre/velojs";
import type { Context } from "hono";
import { resolveAccess, resolveReached, pruneReached, andWhere, prune, ScopeError } from "./scope.js";
import type { ExpandSpec, SelectSpec } from "../engine/control-plane/data.js";

// API wildcard de dados. Casca fina de transporte sobre o control-plane (mesmo
// contrato JSON da GUI). Cada handler resolve o ACESSO (god, ou um scope vindo do
// header `x-weave-scope`): checa o verbo, AND-a o filtro de linhas (WhereInput) e
// poda a projeção. Sem `x-weave-scope` = god (a API key é o segredo confiável).

type WNode = Record<string, unknown>;

const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");
const statusFor = (m: string) => (/unknown entity|not found/i.test(m) ? 404 : 400);

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeError) return c.json({ error: e.message }, e.status as 400 | 403);
  // WITH CHECK violado (write cross-tenant) → 403. Checa por `name` (bundle-safe, sem import do driver).
  if (e instanceof Error && e.name === "WithCheckError") return c.json({ error: e.message }, 403);
  const m = msg(e);
  return c.json({ error: m }, statusFor(m) as 400 | 404);
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const idEquals = (id: string): WNode => ({ id: { eq: id } });

/**
 * Resolve as entities alcançadas por referência (expand/select) contra o scope, e devolve
 * o `expand` efetivo pra query. GOD sai na primeira linha: sem scope não há o que compor,
 * e este é o caminho mais quente — nada de I/O extra nele.
 */
async function reach(
  c: Context,
  entity: string,
  access: { god: boolean },
  expand: ExpandSpec | null,
  select: SelectSpec | null,
): Promise<{ reached: ReachedRule[]; expand: ExpandSpec | null }> {
  if (access.god) return { reached: [], expand };
  const r = await resolveReached(c, entity, expand, select);
  return { reached: r.reached, expand: r.expand as ExpandSpec | null };
}

export async function apiList({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "read");
    const { listObjects } = await import("../engine/control-plane/data.js");
    const page = Math.max(1, Number(query.page) || 1);
    // `findMany` devolve TUDO que casa (default 10k quando não passa `limit`, igual ao
    // idioma do zodMongo); sem cap silencioso. Explicitar `limit`/`perPage` sobe/desce —
    // é honrado sem teto (o dev assume o risco). Antes travava mudo em 20 (default) / 100 (cap).
    const perPage = Math.max(1, Number(query.perPage) || 10000);
    const expand = parseJson<ExpandSpec>(query.expand);
    const select = parseJson<SelectSpec>(query.select);
    const orderBy = parseJson<WNode>(query.orderBy);
    const latestPer = parseJson<string[]>(query.latestPer);
    const userWhere = parseJson<WNode>(query.where);
    const where = access.god ? userWhere : andWhere(access.rows, userWhere);
    // O scope compõe pela referência: as entities alcançadas por expand/select respondem
    // pelas regras DELAS (403 sem `read`; projeção própria). Resolve ANTES da query — sem
    // regra é 403, não vale ir no banco. God NÃO paga nada disso (caminho mais quente).
    const { reached, expand: effExpand } = await reach(c, entity, access, expand, select);
    const res = await listObjects(entity, page, perPage, where, orderBy, effExpand, latestPer, select);
    if (!access.god) res.docs = res.docs.map((d) => pruneReached(prune(d, access.projection), reached));
    return c.json(res);
  } catch (e) {
    return fail(c, e);
  }
}

// POST /api/:entity/aggregate — groupBy + acumuladores + orderBy. O `where` do body
// é AND-ado com o filtro de linhas do scope (a agregação respeita o escopo). Projeção
// não se aplica (o resultado são linhas agregadas, não objetos da entidade).
export async function apiAggregate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "read");
    const { aggregateObjects } = await import("../engine/control-plane/data.js");
    const body = (await c.req.json()) as { where?: WNode } & Record<string, unknown>;
    const where = access.god ? (body.where ?? {}) : (andWhere(access.rows, (body.where ?? {}) as WNode) as WNode);
    // Wire uniforme: sempre { rows, facets } (facets {} quando não há). O SDK é quem
    // dá o açúcar auto-tipado (devolve rows[] pelado quando o input não pediu facets).
    const result = await aggregateObjects(entity, { ...body, where });
    return c.json(result);
  } catch (e) {
    return fail(c, e);
  }
}

// POST /api/:entity/accumulate — upsert mergeável do tier histórico. Body `{ key, ops }`.
// É uma escrita keyed (create-or-merge), então exige o verbo `create` — e, como todo write
// sob scope, passa por WITH CHECK: a linha RESULTANTE (criada ou mergeada) tem que cair no
// filtro de linhas, senão é write cross-tenant (mergear no rollup do vizinho). O alvo é a
// `key`, não um `where`, então a checagem é sobre o resultado — ver `Weave.accumulate`.
export async function apiAccumulate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "create");
    const { accumulateObject } = await import("../engine/control-plane/data.js");
    const body = (await c.req.json()) as { key?: WNode; ops?: Record<string, unknown> };
    if (!body || typeof body !== "object" || !body.key || !body.ops) {
      return c.json({ error: "accumulate needs a { key, ops } body." }, 400);
    }
    const check = access.god ? undefined : (access.rows ?? undefined);
    const row = await accumulateObject(entity, body.key, body.ops as never, check);
    // inc-and-return: a linha volta pro caller, então respeita a projeção do scope.
    return c.json(access.god ? row : prune(row, access.projection));
  } catch (e) {
    return fail(c, e);
  }
}

export async function apiGetOne({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "read");
    const { listObjects } = await import("../engine/control-plane/data.js");
    const where = andWhere(access.rows, idEquals(params.id ?? ""));
    const select = parseJson<SelectSpec>(query.select);
    const { reached, expand: effExpand } = await reach(c, entity, access, parseJson<ExpandSpec>(query.expand), select);
    const obj = (await listObjects(entity, 1, 1, where, null, effExpand, null, select)).docs[0];
    if (!obj) return c.json({ error: "Not found." }, 404);
    return c.json(access.god ? obj : pruneReached(prune(obj, access.projection), reached));
  } catch (e) {
    return fail(c, e);
  }
}

// POST /api/:entity — cria UM objeto (body objeto) ou MUITOS (body array → ingest
// em lote, uma transação). A resposta espelha a entrada: objeto → objeto; array → array.
export async function apiCreate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "create");
    const body = (await c.req.json()) as Record<string, unknown> | Record<string, unknown>[];
    const project = (o: Record<string, unknown>) => (access.god ? o : prune(o, access.projection));
    // WITH CHECK: sob scope, a linha criada tem que cair no filtro de linhas (senão é
    // create cross-tenant). `god`/scope-sem-where → sem check. Ver `WithCheckError` → 403.
    const check = access.god ? undefined : (access.rows ?? undefined);

    if (Array.isArray(body)) {
      const { createManyObjects } = await import("../engine/control-plane/data.js");
      if (body.length > BULK_CAP) throw new ScopeError(`Bulk create exceeds cap of ${BULK_CAP}.`, 400);
      const rows = await createManyObjects(entity, body, check ?? undefined);
      return c.json(rows.map(project), 201);
    }

    const { saveObject } = await import("../engine/control-plane/data.js");
    const obj = (await saveObject(entity, body, check ?? undefined)) as Record<string, unknown>;
    return c.json(project(obj), 201);
  } catch (e) {
    return fail(c, e);
  }
}

/** Resolve o where efetivo (user + filtro de linhas do scope) e exige que exista. */
function mutationWhere(access: { god: boolean; rows: WNode | null }, query: Record<string, string | undefined>): WNode {
  const userWhere = parseJson<WNode>(query.where);
  if (!userWhere || Object.keys(userWhere).length === 0) {
    throw new ScopeError("A where is required for update/delete.", 400);
  }
  return access.god ? userWhere : (andWhere(access.rows, userWhere) as WNode);
}

// Teto de linhas afetadas por um bulk (guarda contra rodar sem querer sobre tudo).
const BULK_CAP = 100_000;

// PATCH /api/:entity — atualiza por WHERE. `?mode=many` → bulk (`{ count }`);
// senão o PRIMEIRO match (`orderBy` desempata) → o objeto atualizado, ou 404→null.
export async function apiUpdate({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "update");
    const { listObjects, saveObject } = await import("../engine/control-plane/data.js");
    const where = mutationWhere(access, query);
    const orderBy = parseJson<WNode>(query.orderBy);
    const patch = (await c.req.json()) as Record<string, unknown>;
    // WITH CHECK no update: o resultado (upsert do merge) tem que CONTINUAR no filtro do
    // scope — impede o patch de MOVER a linha pra fora do tenant (ex.: trocar o FK).
    const check = access.god ? undefined : (access.rows ?? undefined);
    // merge: campos omitidos vêm do objeto atual (owned/refs preservados).
    const apply = (existing: WNode) => saveObject(entity, { ...existing, ...patch, id: existing.id }, check ?? undefined);

    if (query.mode === "many") {
      const rows = (await listObjects(entity, 1, BULK_CAP, where, orderBy)).docs;
      for (const existing of rows) await apply(existing as WNode);
      return c.json({ count: rows.length });
    }
    const existing = (await listObjects(entity, 1, 1, where, orderBy)).docs[0];
    if (!existing) return c.json({ error: "Not found." }, 404);
    const obj = (await apply(existing as WNode)) as WNode;
    return c.json(access.god ? obj : prune(obj, access.projection));
  } catch (e) {
    return fail(c, e);
  }
}

// DELETE /api/:entity — deleta por WHERE. `?mode=many` → bulk (`{ count }`);
// senão o PRIMEIRO match → o objeto deletado, ou 404→null.
export async function apiDelete({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "delete");
    const { listObjects, deleteObject } = await import("../engine/control-plane/data.js");
    const where = mutationWhere(access, query);
    const orderBy = parseJson<WNode>(query.orderBy);

    if (query.mode === "many") {
      const rows = (await listObjects(entity, 1, BULK_CAP, where, orderBy)).docs;
      for (const row of rows) await deleteObject(entity, String((row as WNode).id));
      return c.json({ count: rows.length });
    }
    const existing = (await listObjects(entity, 1, 1, where, orderBy)).docs[0] as WNode | undefined;
    if (!existing) return c.json({ error: "Not found." }, 404);
    await deleteObject(entity, String(existing.id));
    return c.json(access.god ? existing : prune(existing, access.projection));
  } catch (e) {
    return fail(c, e);
  }
}
