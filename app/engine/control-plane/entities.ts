import { db } from "./db.js";
import { validateIR, normalizeEntityIR, ensureFieldIds, resolveMirrors, fromIR, tableize, diffEntityIR, type EntityDiff, type EntityIR } from "@mauroandre/weave-core";
import { collectTables } from "../ddl/emit.js";
import { probePlan, applyMigration } from "./migrate.js";
import { setPending, clearPending, type PendingEntry } from "./pending.js";

/** Lista as plantas (IR) guardadas no metastore. */
export async function listEntities(): Promise<EntityIR[]> {
  const sql = db();
  const rows = await sql<{ ir: EntityIR | string }[]>`SELECT ir FROM weave_entities ORDER BY name`;
  return rows.map((r) => parseIR(r.ir));
}

/** Lê a planta (IR) de uma entidade pelo nome (ou null se não existir). O nome de
 *  entrada é normalizado (`tableize`) — camelCase do SDK resolve pro nome guardado. */
export async function getEntity(name: string): Promise<EntityIR | null> {
  const sql = db();
  const rows = await sql<{ ir: EntityIR | string }[]>`SELECT ir FROM weave_entities WHERE name = ${tableize(name)}`;
  return rows[0] ? parseIR(rows[0].ir) : null;
}

function parseIR(ir: EntityIR | string): EntityIR {
  return typeof ir === "string" ? (JSON.parse(ir) as EntityIR) : ir;
}

/**
 * Remove a entidade: **dropa as tabelas físicas** que ela criou (raiz + owned children
 * + join N:N, via `collectTables`) e apaga o metastore. Ação destrutiva (a GUI confirma).
 * `CASCADE` derruba FKs de quem a referenciava; owned/join caem juntos.
 */
export async function deleteEntity(name: string): Promise<void> {
  const canonical = tableize(name);
  const sql = db();
  const irs = await listEntities();
  const ir = irs.find((e) => e.name === canonical);
  if (ir) {
    const byName = new Map(irs.map((e) => [e.name, e] as const));
    const entities = fromIR(irs.map((e) => resolveMirrors(e, byName)));
    const specs = collectTables(entities[canonical]!);
    // Ordem reversa (children/join antes da raiz); CASCADE cobre dependentes.
    for (const spec of [...specs].reverse()) {
      await sql`DROP TABLE IF EXISTS ${sql(spec.name)} CASCADE`;
    }
  }
  await sql`DELETE FROM weave_entities WHERE name = ${canonical}`;
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

export interface ProjectOptions {
  /** Drops confirmados, por nome de entidade. */
  confirm?: Record<string, string[]>;
  /** Backfill (path → valor), por nome de entidade. */
  fill?: Record<string, Record<string, unknown>>;
  /** De onde veio: "boot" | "cli" | "gui". Só informativo, vai pro pending. */
  source?: string;
}
export interface ProjectOutcome {
  applied: string[];
  review: { name: string; plan: EntityDiff }[];
}

/**
 * Aplica um CONJUNTO de entidades (um push de projeto) e **persiste o pending** com o
 * que ficou retido. Cada entity é atômica (via `applyEntity`); as convergidas entram em
 * `applied`, as retidas viram `review` + são guardadas no slot único (com o IR desejado,
 * pra a GUI resolver depois). Se nada reteve, limpa o pending. É o motor por trás do
 * `pushAll` (boot/CLI) e da resolução na GUI — mesmo apply, fontes diferentes.
 *
 * Ordem: aplica na ordem recebida (o chamador topo-ordena por dependência).
 */
export async function applyProject(inputs: unknown[], opts: ProjectOptions = {}): Promise<ProjectOutcome> {
  const applied: string[] = [];
  const entries: PendingEntry[] = [];
  for (const input of inputs) {
    const name = ((input as { name?: string })?.name ?? "").toString();
    const out = await applyEntity(input, {
      ...(opts.confirm?.[name] ? { confirm: opts.confirm[name] } : {}),
      ...(opts.fill?.[name] ? { fill: opts.fill[name] } : {}),
    });
    if (out.status === "applied") applied.push(name);
    else entries.push({ name, ir: input as EntityIR, plan: out.plan });
  }
  if (entries.length) {
    await setPending({ createdAt: new Date().toISOString(), source: opts.source ?? "cli", entries });
  } else {
    await clearPending();
  }
  return { applied, review: entries.map((e) => ({ name: e.name, plan: e.plan })) };
}
