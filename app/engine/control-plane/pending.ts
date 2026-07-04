import { db } from "./db.js";
import type { EntityIR, EntityDiff } from "@mauroandre/weave-core";

// Pending de migração: o resultado de um `applyProject` que NÃO convergiu inteiro —
// as entidades retidas (com o IR desejado + o plano de riscos). Guardado num SLOT
// ÚNICO (weave_pending, id=1): o próximo push sobrescreve (last-writer-wins). A GUI lê
// isso e resolve; a resolução aplica e limpa. Só o `applyProject` cria pending.

/** Uma entidade retida no pending: o desejado (pra re-aplicar) + o plano (pra a GUI mostrar). */
export interface PendingEntry {
  name: string;
  /** IR desejado — o alvo que o push queria; a resolução aplica ISTO + confirm/fill. */
  ir: EntityIR;
  /** Mudanças com risco (op/path/risk) — o que a GUI mostra e você resolve. */
  plan: EntityDiff;
}

export interface Pending {
  createdAt: string;
  /** De onde veio o push: "boot" | "cli" | "gui". Best-effort, só informativo. */
  source: string;
  entries: PendingEntry[];
}

/** Lê o pending atual, ou null se convergido (slot vazio). */
export async function getPending(): Promise<Pending | null> {
  const sql = db();
  const rows = await sql<{ data: Pending | string }[]>`SELECT data FROM weave_pending WHERE id = 1`;
  const raw = rows[0]?.data;
  if (raw == null) return null;
  // jsonb pode voltar como string (convenção do codebase, ver listEntities).
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Pending;
}

/** Grava o pending (upsert do slot único). */
export async function setPending(pending: Pending): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO weave_pending (id, data, updated_at)
    VALUES (1, ${JSON.stringify(pending)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

/** Limpa o pending (convergiu). */
export async function clearPending(): Promise<void> {
  const sql = db();
  await sql`DELETE FROM weave_pending WHERE id = 1`;
}
