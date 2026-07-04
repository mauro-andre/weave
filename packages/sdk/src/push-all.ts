import path from "node:path";
import { toIR } from "../../core/src/index.js";
import type { EntityIR } from "../../core/src/index.js";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";
import { discoverEntities, discoverScopes, type ModuleLoader } from "./discover.js";
import { pushScopes } from "./scope.js";
import { depsOf, type PushResult } from "./push.js";

// `pushAll` — o push de PROJETO (Node): descobre entities + scopes da pasta `weave/`,
// aplica via `POST /admin/push` (o `applyProject` do servidor, que persiste o pending),
// e depois os scopes (só se as entities convergirem). Devolve `{ applied, review, scopes }`.
// É o que o boot chama num loop e o que substitui montar `pushEntities(...)` na mão.
// **Sempre no-gen** — não escreve arquivo de volta (o container é efêmero; o gen é do CLI).

export interface PushAllOptions {
  url: string;
  key: string;
  /** Pasta do projeto (contém `entities/` e `scopes/`). Default `"weave"`. */
  dir?: string;
  fetch?: FetchLike;
  /** Loader de módulo (Node import). Injetável nos testes. */
  load?: ModuleLoader;
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
  const dir = opts.dir ?? "weave";

  // Descobre + serializa (toIR) + topo-ordena (referida antes da que referencia).
  const entities = await discoverEntities(path.join(dir, "entities"), opts.load);
  const irs = Object.values(entities).map((e) => toIR(e));
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

  // Scopes só depois das entities convergirem (referenciam campo por id no servidor).
  let scopes: string[] = [];
  if (review.length === 0) {
    const scopeDefs = await discoverScopes(path.join(dir, "scopes"), opts.load);
    if (Object.keys(scopeDefs).length > 0) {
      const net = { url: opts.url, key: opts.key, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
      const { pushed } = await pushScopes(scopeDefs, net);
      scopes = pushed;
    }
  }

  return { applied, review, scopes };
}
