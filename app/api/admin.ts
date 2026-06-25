import type { EndpointHandlerArgs } from "@mauroandre/velojs";
import type { Context } from "hono";
import type { Scope } from "../engine/control-plane/scopes.js";

// API de administração (control-plane via HTTP): gerir entidades e scopes
// programaticamente — alimenta o SDK/codegen e o IaC. Mesma auth da API de dados
// (a key é o limite de confiança). Entidades usam o **plan/apply** seguro: PUT
// devolve `applied` (200) ou `needsReview` (409) + o plano classificado.

const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");
const statusFor = (m: string) => (/unknown|not found/i.test(m) ? 404 : 400);
function fail(c: Context, e: unknown): Response {
  const m = msg(e);
  return c.json({ error: m }, statusFor(m) as 400 | 404);
}

// ── Entities ──────────────────────────────────────────────────────────────────
export async function adminListEntities({ c }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { listEntities } = await import("../engine/control-plane/entities.js");
    return c.json({ entities: await listEntities() });
  } catch (e) {
    return fail(c, e);
  }
}

export async function adminGetEntity({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { getEntity } = await import("../engine/control-plane/entities.js");
    const ir = await getEntity(params.name ?? "");
    if (!ir) return c.json({ error: "Not found." }, 404);
    return c.json(ir);
  } catch (e) {
    return fail(c, e);
  }
}

export async function adminPutEntity({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { applyEntity } = await import("../engine/control-plane/entities.js");
    const body = (await c.req.json()) as {
      ir?: Record<string, unknown>;
      confirm?: string[];
      fill?: Record<string, unknown>;
    };
    const ir = { ...(body.ir ?? {}), name: params.name }; // a URL é a autoridade do nome
    const out = await applyEntity(ir, {
      ...(body.confirm ? { confirm: body.confirm } : {}),
      ...(body.fill ? { fill: body.fill } : {}),
    });
    return c.json(out, out.status === "applied" ? 200 : 409);
  } catch (e) {
    return fail(c, e);
  }
}

export async function adminDeleteEntity({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { deleteEntity } = await import("../engine/control-plane/entities.js");
    await deleteEntity(params.name ?? "");
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
}

// ── Scopes ────────────────────────────────────────────────────────────────────
export async function adminListScopes({ c }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { listScopes } = await import("../engine/control-plane/scopes.js");
    return c.json({ scopes: await listScopes() });
  } catch (e) {
    return fail(c, e);
  }
}

export async function adminGetScope({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { getScope } = await import("../engine/control-plane/scopes.js");
    const s = await getScope(params.name ?? "");
    if (!s) return c.json({ error: "Not found." }, 404);
    return c.json(s);
  } catch (e) {
    return fail(c, e);
  }
}

export async function adminPutScope({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { saveScope } = await import("../engine/control-plane/scopes.js");
    const body = (await c.req.json()) as { entities?: Scope["entities"] };
    await saveScope({ name: params.name ?? "", entities: body.entities ?? {} });
    return c.json({ ok: true, name: params.name });
  } catch (e) {
    return fail(c, e);
  }
}

export async function adminDeleteScope({ c, params }: EndpointHandlerArgs): Promise<Response> {
  try {
    const { deleteScope } = await import("../engine/control-plane/scopes.js");
    await deleteScope(params.name ?? "");
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
}
