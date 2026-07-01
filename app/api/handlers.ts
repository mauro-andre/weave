import type { EndpointHandlerArgs } from "@mauroandre/velojs";
import type { Context } from "hono";
import { resolveAccess, andWhere, prune, ScopeError } from "./scope.js";
import type { ExpandSpec } from "../engine/control-plane/data.js";

// API wildcard de dados. Casca fina de transporte sobre o control-plane (mesmo
// contrato JSON da GUI). Cada handler resolve o ACESSO (god, ou um scope vindo do
// header `x-weave-scope`): checa o verbo, AND-a o filtro de linhas (WhereInput) e
// poda a projeção. Sem `x-weave-scope` = god (a API key é o segredo confiável).

type WNode = Record<string, unknown>;

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

const idEquals = (id: string): WNode => ({ id: { eq: id } });

export async function apiList({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  try {
    const entity = params.entity ?? "";
    const access = await resolveAccess(c, entity, "read");
    const { listObjects } = await import("../engine/control-plane/data.js");
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
    const expand = parseJson<ExpandSpec>(query.expand);
    const orderBy = parseJson<WNode>(query.orderBy);
    const userWhere = parseJson<WNode>(query.where);
    const where = access.god ? userWhere : andWhere(access.rows, userWhere);
    const res = await listObjects(entity, page, perPage, where, orderBy, expand);
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
    const where = andWhere(access.rows, idEquals(params.id ?? ""));
    const obj = (await listObjects(entity, 1, 1, where, null, parseJson<ExpandSpec>(query.expand))).docs[0];
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
    // merge: campos omitidos vêm do objeto atual (owned/refs preservados).
    const apply = (existing: WNode) => saveObject(entity, { ...existing, ...patch, id: existing.id });

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
