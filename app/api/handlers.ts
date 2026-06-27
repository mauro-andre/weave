import type { EndpointHandlerArgs } from "@mauroandre/velojs";
import type { Context } from "hono";
import { resolveAccess, andFilter, prune, ScopeError } from "./scope.js";
import type { Filter } from "../engine/control-plane/filter.js";
import type { SortKey } from "../engine/control-plane/sort.js";
import type { ExpandSpec } from "../engine/control-plane/data.js";

// API wildcard de dados. Casca fina de transporte sobre o control-plane (mesmo
// contrato JSON da GUI). Cada handler resolve o ACESSO (god, ou um scope vindo do
// header `x-weave-scope`): checa o verbo, AND-a o filtro de linhas e poda a
// projeção. Sem `x-weave-scope` = god (a API key é o segredo confiável).

const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");
const statusFor = (m: string) => (/unknown entity|not found/i.test(m) ? 404 : 400);

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeError) return c.json({ error: e.message }, e.status as 400 | 403);
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

const idEquals = (id: string) => ({ path: ["id"], op: "equals", value: id });

export async function apiList({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "read");
    const { listObjects } = await import("../engine/control-plane/data.js");
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
    const userFilter = parseJson<Filter>(query.filter);
    const filter = access.god ? userFilter : andFilter(access.rows, userFilter);
    const res = await listObjects(
      entity,
      page,
      perPage,
      filter,
      parseJson<SortKey[]>(query.sort),
      parseJson<ExpandSpec>(query.expand),
    );
    if (!access.god) res.docs = res.docs.map((d) => prune(d, access.projection));
    return c.json(res);
  } catch (e) {
    return fail(c, e);
  }
}

export async function apiGetOne({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "read");
    const { listObjects } = await import("../engine/control-plane/data.js");
    const filter = access.god ? idEquals(params.id ?? "") : andFilter(access.rows, idEquals(params.id ?? ""));
    const obj = (await listObjects(entity, 1, 1, filter, null, parseJson<ExpandSpec>(query.expand))).docs[0];
    if (!obj) return c.json({ error: "Not found." }, 404);
    return c.json(access.god ? obj : prune(obj, access.projection));
  } catch (e) {
    return fail(c, e);
  }
}

export async function apiCreate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "create");
    const { saveObject } = await import("../engine/control-plane/data.js");
    const body = (await c.req.json()) as Record<string, unknown>;
    const obj = (await saveObject(entity, body)) as Record<string, unknown>;
    return c.json(access.god ? obj : prune(obj, access.projection), 201);
  } catch (e) {
    return fail(c, e);
  }
}

export async function apiUpdate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "update");
    const { listObjects, saveObject } = await import("../engine/control-plane/data.js");
    const filter = access.god ? idEquals(params.id ?? "") : andFilter(access.rows, idEquals(params.id ?? ""));
    const existing = (await listObjects(entity, 1, 1, filter)).docs[0];
    if (!existing) return c.json({ error: "Not found." }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    // PATCH = merge: campos omitidos vêm do objeto atual (owned/refs preservados).
    const obj = (await saveObject(entity, { ...existing, ...body, id: params.id })) as Record<string, unknown>;
    return c.json(access.god ? obj : prune(obj, access.projection));
  } catch (e) {
    return fail(c, e);
  }
}

export async function apiDelete({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "delete");
    const { listObjects, deleteObject } = await import("../engine/control-plane/data.js");
    const filter = access.god ? idEquals(params.id ?? "") : andFilter(access.rows, idEquals(params.id ?? ""));
    const existing = (await listObjects(entity, 1, 1, filter)).docs[0];
    if (!existing) return c.json({ error: "Not found." }, 404);
    await deleteObject(entity, params.id ?? "");
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
}
