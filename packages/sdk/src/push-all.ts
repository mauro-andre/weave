import { toIR } from "../../core/src/index.js";
import type { Entity, EntityIR, ShapeRecord } from "../../core/src/index.js";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";
import { pushScopes, type ScopeDef } from "./scope.js";
import { depsOf, type PushResult } from "./push.js";

// `pushAll` — o push de PROJETO: entities + scopes ATÔMICOS (um push = o desejo de UM
// deploy), a partir de OBJETOS já em memória. É o que o app server chama no boot loop:
//
//   import * as entities from "./weave/entities/index.js";
//   import * as scopes   from "./weave/scopes/index.js";
//   await pushAll({ url, key, entities, scopes, source: "boot" });
//
// SEM discovery de disco (que quebrava no boot: o loader não faz `.js`→`.ts` no dev, e em
// prod dependeria de shipar `weave/` como `.js`). Por não tocar `node:fs`, é puro (só APIs
// web: Request/fetch) e vive no barrel PRINCIPAL, ao lado de pushEntities/pushScopes.
// Aplica via POST /admin/push (o applyProject do servidor, que persiste o pending
// resolvível na GUI) e empurra os scopes só DEPOIS das entities convergirem (o server
// referencia campo por id). Sempre no-gen. `scopes` ausente/`{}` → nenhum scope (no-op).

export interface PushAllOptions {
  url: string;
  key: string;
  /** Entities já carregadas — `import * as entities from "weave/entities/index.js"`. */
  entities: Record<string, Entity<string, ShapeRecord>>;
  /** Scopes já carregados. Ausente/`{}` → nenhum scope a empurrar (muitos projetos não têm).
   *  `ScopeDef<string>` (não o default `<never>`) pra aceitar scopes COM params inferidos. */
  scopes?: Record<string, ScopeDef<string>>;
  fetch?: FetchLike;
  /** Drops confirmados / backfills, por entidade (resolução não-interativa). */
  confirm?: Record<string, string[]>;
  fill?: Record<string, Record<string, unknown>>;
  /** Origem, pro pending: "boot" | "cli" | "gui". */
  source?: string;
}

export interface PushAllResult extends PushResult {
  /** Scopes empurrados (só quando as entities convergiram; senão vazio). */
  scopes: string[];
}

export async function pushAll(opts: PushAllOptions): Promise<PushAllResult> {
  const transport: FetchLike = opts.fetch ?? ((req) => globalThis.fetch(req));
  const base = opts.url.replace(/\/$/, "");

  // Serializa (toIR) + topo-ordena (referida antes da que referencia).
  const irs = Object.values(opts.entities).map((e) => toIR(e));
  const byName = new Map(irs.map((ir) => [ir.name, ir] as const));
  const ordered: EntityIR[] = [];
  const seen = new Set<string>();
  const visit = (ir: EntityIR): void => {
    if (seen.has(ir.name)) return;
    seen.add(ir.name);
    for (const dep of depsOf(ir)) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    ordered.push(ir);
  };
  for (const ir of irs) visit(ir);

  // POST /admin/push → applyProject (aplica + persiste o pending).
  const res = await transport(
    new Request(`${base}/admin/push`, {
      method: "POST",
      headers: { "x-api-key": opts.key, "content-type": "application/json" },
      body: JSON.stringify({
        entities: ordered,
        confirm: opts.confirm,
        fill: opts.fill,
        source: opts.source ?? "cli",
      }),
    }),
  );
  const json = (await res.json().catch(() => null)) as (PushResult & { error?: string }) | null;
  if (!res.ok || !json) throw errorFor(res.status, json?.error ?? `Push failed (${res.status}).`);
  const { applied, review } = json;

  // Scopes só depois das entities convergirem (o server referencia campo por id).
  let scopes: string[] = [];
  if (review.length === 0 && opts.scopes && Object.keys(opts.scopes).length > 0) {
    const net = { url: opts.url, key: opts.key, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
    const { pushed } = await pushScopes(opts.scopes, net);
    scopes = pushed;
  }

  return { applied, review, scopes };
}
