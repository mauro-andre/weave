import { db } from "./db.js";

export interface WeaveUser {
  id: string;
  username: string;
  password_hash: string;
  /** Secret TOTP cifrado em repouso (AES-256-GCM, ver twofa.ts) — nunca em claro. */
  twofa_secret: string | null;
  /** Fator ativo. Pendente de confirmação = secret sem enabled. */
  twofa_enabled: boolean;
  /** Último passo TOTP consumido (anti-replay). */
  twofa_last_step: number | null;
  /** Hashes sha256 dos códigos de recuperação ainda não consumidos. */
  twofa_recovery: string[] | null;
}

export async function findUserByUsername(username: string): Promise<WeaveUser | null> {
  const sql = db();
  const rows = await sql<WeaveUser[]>`
    SELECT id, username, password_hash, twofa_secret, twofa_enabled, twofa_last_step, twofa_recovery
    FROM weave_users WHERE username = ${username}
  `;
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<WeaveUser | null> {
  const sql = db();
  const rows = await sql<WeaveUser[]>`
    SELECT id, username, password_hash, twofa_secret, twofa_enabled, twofa_last_step, twofa_recovery
    FROM weave_users WHERE id = ${id}
  `;
  return rows[0] ?? null;
}
