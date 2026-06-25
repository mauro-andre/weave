import type { EndpointHandlerArgs } from "@mauroandre/velojs";

// API wildcard de dados (god-mode). Casca fina de transporte sobre o control-plane
// — o mesmo contrato JSON da GUI (filtro/sort em query, owned aninhado na resposta).
//
// ┌─ COSTURA DE SCOPES (F5) ────────────────────────────────────────────────────┐
// │ Este handler é o chokepoint único. Quando os scopes entrarem, aqui se faz:    │
// │   1. resolver identidade (header do caller confiável) → scope da entidade;    │
// │   2. negar se o verbo (read/create/update/delete) não estiver no scope;       │
// │   3. AND-ar o WHERE do scope no filtro do usuário (reusa o compileFilter —     │
// │      Filter já é árvore AND/OR, então é `{ and: [scopeCond, userFilter] }`);   │
// │   4. podar a projeção na resposta.                                            │
// │ God-mode (agora) = nenhum desses passos. Sem mudança de assinatura depois.    │
// └──────────────────────────────────────────────────────────────────────────────┘

const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");
const statusFor = (m: string) => (/unknown entity|not found/i.test(m) ? 404 : 400);

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function apiList({ c, params, query }: EndpointHandlerArgs): Promise<Response> {
  const { listObjects } = await import("../engine/control-plane/data.js");
  try {
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
    const res = await listObjects(params.entity ?? "", page, perPage, parseJson(query.filter), parseJson(query.sort));
    return c.json(res);
  } catch (e) {
    return c.json({ error: msg(e) }, statusFor(msg(e)));
  }
}

export async function apiGetOne({ c, params }: EndpointHandlerArgs): Promise<Response> {
  const { getObject } = await import("../engine/control-plane/data.js");
  try {
    const obj = await getObject(params.entity ?? "", params.id ?? "");
    if (!obj) return c.json({ error: "Not found." }, 404);
    return c.json(obj);
  } catch (e) {
    return c.json({ error: msg(e) }, statusFor(msg(e)));
  }
}

export async function apiCreate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  const { saveObject } = await import("../engine/control-plane/data.js");
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const obj = await saveObject(params.entity ?? "", body);
    return c.json(obj, 201);
  } catch (e) {
    return c.json({ error: msg(e) }, statusFor(msg(e)));
  }
}

export async function apiUpdate({ c, params }: EndpointHandlerArgs): Promise<Response> {
  const { getObject, saveObject } = await import("../engine/control-plane/data.js");
  try {
    const existing = await getObject(params.entity ?? "", params.id ?? "");
    if (!existing) return c.json({ error: "Not found." }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    // PATCH = merge: campos omitidos vêm do objeto atual (owned/refs preservados).
    const obj = await saveObject(params.entity ?? "", { ...existing, ...body, id: params.id });
    return c.json(obj);
  } catch (e) {
    return c.json({ error: msg(e) }, statusFor(msg(e)));
  }
}

export async function apiDelete({ c, params }: EndpointHandlerArgs): Promise<Response> {
  const { deleteObject } = await import("../engine/control-plane/data.js");
  try {
    await deleteObject(params.entity ?? "", params.id ?? "");
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: msg(e) }, statusFor(msg(e)));
  }
}
