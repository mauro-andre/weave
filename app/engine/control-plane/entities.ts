import { db } from "./db.js";
import { validateIR, normalizeEntityIR, ensureFieldIds, resolveMirrors, fromIR, diffEntityIR, type EntityDiff, type EntityIR } from "@mauroandre/weave-core";
import { probePlan, applyMigration } from "./migrate.js";

/** Lista as plantas (IR) guardadas no metastore. */
export async function listEntities(): Promise<EntityIR[]> {
  const sql = db();
  const rows = await sql<{ ir: EntityIR | string }[]>`SELECT ir FROM weave_entities ORDER BY name`;
  return rows.map((r) => parseIR(r.ir));
}

/** Lê a planta (IR) de uma entidade pelo nome (ou null se não existir). */
export async function getEntity(name: string): Promise<EntityIR | null> {
  const sql = db();
  const rows = await sql<{ ir: EntityIR | string }[]>`SELECT ir FROM weave_entities WHERE name = ${name}`;
  return rows[0] ? parseIR(rows[0].ir) : null;
}

function parseIR(ir: EntityIR | string): EntityIR {
  return typeof ir === "string" ? (JSON.parse(ir) as EntityIR) : ir;
}

/** Remove a entidade do metastore. A tabela física fica (sync é aditivo). */
export async function deleteEntity(name: string): Promise<void> {
  const sql = db();
  await sql`DELETE FROM weave_entities WHERE name = ${name}`;
}

/**
 * Dry-run: calcula o plano de mudanças (intenção, via diff por id) **sem**
 * tocar no banco. Mesmo pipeline do save (normaliza + garante ids) pra que o
 * rename seja detectado do mesmo jeito.
 */
export async function planEntity(input: unknown): Promise<EntityDiff> {
  const normalized = normalizeEntityIR(validateIR(input));
  const previous = await getEntity(normalized.name);
  const next = ensureFieldIds(normalized, previous);
  return diffEntityIR(previous, next);
}

export interface ApplyOptions {
  /** Caminhos de `removeField` que o usuário confirmou (apaga dado). */
  confirm?: string[];
  /** Valor de backfill por caminho, para os casos `needsValue`. */
  fill?: Record<string, unknown>;
}

export interface ApplyOutcome {
  /** `applied` = gravou e materializou; `needsReview` = nada aplicado, revise. */
  status: "applied" | "needsReview";
  name: string;
  /** Plano sondado (riscos reais), pra a folha de revisão. */
  plan: EntityDiff;
}

/**
 * Grava + materializa uma entidade aplicando o plano de mudanças numa transação
 * (rename preserva dado, drops confirmados, backfill uniforme). Se houver algo
 * bloqueado, não-confirmado ou sem valor, **não aplica nada** e devolve o plano
 * pra revisão. Valida o IR antes; lança em IR inválido.
 */
export async function applyEntity(input: unknown, opts: ApplyOptions = {}): Promise<ApplyOutcome> {
  const normalized = normalizeEntityIR(validateIR(input));
  const sql = db();
  const previous = await getEntity(normalized.name);
  const next = ensureFieldIds(normalized, previous);
  const plan = await probePlan(sql, next, diffEntityIR(previous, next));

  const confirm = new Set(opts.confirm ?? []);
  const fill = opts.fill ?? {};
  const stuck =
    plan.changes.some((c) => c.risk === "blocked") ||
    plan.changes.some((c) => c.risk === "confirm" && !confirm.has(c.path)) ||
    plan.changes.some((c) => c.risk === "needsValue" && fill[c.path] === undefined);
  if (stuck) return { status: "needsReview", name: next.name, plan };

  // Conjunto do engine = todas as entidades, com `next` no lugar (ou somada).
  const all = await listEntities();
  const merged = all.some((e) => e.name === next.name)
    ? all.map((e) => (e.name === next.name ? next : e))
    : [...all, next];
  const byName = new Map(merged.map((ir) => [ir.name, ir] as const));
  const entities = fromIR(merged.map((ir) => resolveMirrors(ir, byName)));

  await sql.begin(async (tx) => {
    await applyMigration(tx, { prev: previous ?? next, next, entities, changes: plan.changes, fill });
    await tx`
      INSERT INTO weave_entities (name, ir)
      VALUES (${next.name}, ${JSON.stringify(next)}::jsonb)
      ON CONFLICT (name) DO UPDATE SET ir = EXCLUDED.ir, updated_at = now()
    `;
  });

  return { status: "applied", name: next.name, plan };
}
