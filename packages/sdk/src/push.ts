import { toIR } from "../../core/src/index.js";
import type { Entity, ShapeRecord, EntityIR, FieldIR } from "../../core/src/index.js";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";

export interface PushOptions {
  /** Base URL do Weave. */
  url: string;
  /** API key (`x-api-key`). */
  key: string;
  /** Transporte. Default: `globalThis.fetch`. Nos testes: `app.hono.fetch`. */
  fetch?: FetchLike;
  /** Caminhos confirmados (drops destrutivos), por nome de entidade. */
  confirm?: Record<string, string[]>;
  /** Valores de backfill (caminho → valor), por nome de entidade. */
  fill?: Record<string, Record<string, unknown>>;
  /**
   * Renames de campo, por entidade: `{ entidade: { nomeAntigo: nomeNovo } }`.
   * Sem isso, renomear no código vira drop+add (com gate); aqui injetamos o id
   * existente no campo novo → o servidor detecta um RENAME (dado preservado).
   */
  renames?: Record<string, Record<string, string>>;
}

/** Uma mudança no plano de migração (em vocabulário de objeto, nunca SQL). */
export interface PlanChange {
  op: string;
  path: string;
  /** `auto` 🟢 · `confirm` 🔴 · `needsValue` 🟡 · `blocked` ⛔ */
  risk: string;
}
export interface MigrationPlan {
  changes: PlanChange[];
}

export interface PushResult {
  /** Entidades aplicadas (criadas/migradas). */
  applied: string[];
  /** Entidades que precisam de revisão (com o plano por risco). */
  review: { name: string; plan: MigrationPlan }[];
}

/** Lê o IR atual de uma entidade do servidor (ou null se não existe). */
async function fetchIR(transport: FetchLike, base: string, key: string, name: string): Promise<EntityIR | null> {
  const res = await transport(
    new Request(`${base}/admin/entities/${encodeURIComponent(name)}`, { method: "GET", headers: { "x-api-key": key } }),
  );
  if (!res.ok) return null; // 404 (nova) ou erro → sem renames a aplicar
  return (await res.json().catch(() => null)) as EntityIR | null;
}

/** Dependências de uma entidade (alvos de reference + mirror), pra ordenar o apply. */
export function depsOf(ir: EntityIR): Set<string> {
  const deps = new Set<string>();
  const walk = (fields: Record<string, FieldIR>): void => {
    for (const node of Object.values(fields)) {
      if (node.kind === "reference") deps.add(node.target);
      else if (node.kind === "owned") {
        if (node.mirror) deps.add(node.mirror);
        if (node.shape) walk(node.shape);
      }
    }
  };
  walk(ir.fields);
  return deps;
}

/**
 * Empurra o entities-as-code pro Weave: serializa cada entidade (`toIR`) e aplica via
 * `/admin/entities` (plan/apply seguro). Aplica em **ordem de dependência** (a
 * entidade referida antes da que referencia). Devolve o que foi aplicado e o que
 * precisa de revisão (com o plano por risco) — em vocabulário de objeto, sem SQL.
 *
 * `confirm`/`fill` (por entidade) destravam drops confirmados e backfills.
 */
export async function pushEntities(
  entities: Record<string, Entity<string, ShapeRecord>>,
  options: PushOptions,
): Promise<PushResult> {
  const transport: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req));
  const base = options.url.replace(/\/$/, "");

  const irs = Object.values(entities).map((e) => ({ name: e.name, ir: toIR(e) }));
  const byName = new Map(irs.map((x) => [x.name, x] as const));

  // Topo-sort: dependências (dentro do entities) aplicadas primeiro.
  const ordered: { name: string; ir: EntityIR }[] = [];
  const seen = new Set<string>();
  const visit = (x: { name: string; ir: EntityIR }): void => {
    if (seen.has(x.name)) return;
    seen.add(x.name);
    for (const dep of depsOf(x.ir)) {
      const d = byName.get(dep);
      if (d) visit(d); // deps externas (já existentes no servidor) são assumidas
    }
    ordered.push(x);
  };
  for (const x of irs) visit(x);

  const applied: string[] = [];
  const review: { name: string; plan: MigrationPlan }[] = [];

  for (const { name, ir } of ordered) {
    // Rename: injeta o id do campo antigo no campo novo (o servidor vê rename).
    const renameMap = options.renames?.[name];
    if (renameMap && Object.keys(renameMap).length > 0) {
      const existing = await fetchIR(transport, base, options.key, name);
      if (existing) {
        const idByOldName = new Map<string, string>();
        for (const [fname, fnode] of Object.entries(existing.fields)) if (fnode.id) idByOldName.set(fname, fnode.id);
        for (const [oldName, newName] of Object.entries(renameMap)) {
          const id = idByOldName.get(oldName);
          const target = ir.fields[newName];
          if (id && target) ir.fields = { ...ir.fields, [newName]: { ...target, id } };
        }
      }
    }

    const body: Record<string, unknown> = { ir };
    if (options.confirm?.[name]) body.confirm = options.confirm[name];
    if (options.fill?.[name]) body.fill = options.fill[name];

    const res = await transport(
      new Request(`${base}/admin/entities/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "x-api-key": options.key, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const json = (await res.json().catch(() => null)) as
      | { status?: string; plan?: MigrationPlan; error?: string }
      | null;

    if (res.status === 200) applied.push(name);
    else if (res.status === 409 && json?.plan) review.push({ name, plan: json.plan });
    else throw errorFor(res.status, json?.error ?? `Push failed for '${name}' (${res.status}).`);
  }

  return { applied, review };
}
