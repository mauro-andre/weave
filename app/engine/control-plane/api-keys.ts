import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

// Chaves da API. A key é alta-entropia (random), então um sha256 determinístico
// basta (e é indexável p/ lookup) — guardamos só o hash; o texto cru aparece 1x.

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Cria uma chave. Retorna o texto **completo uma única vez** (não é recuperável). */
export async function createApiKey(name: string): Promise<{ id: string; name: string; prefix: string; key: string }> {
  const key = `weave_sk_${randomBytes(24).toString("base64url")}`;
  const prefix = key.slice(0, 16);
  const sql = db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO weave_api_keys (name, key_hash, prefix)
    VALUES (${name}, ${hashKey(key)}, ${prefix})
    RETURNING id
  `;
  return { id: row!.id, name, prefix, key };
}

/** Lista as chaves (sem o hash; nunca o texto). */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const sql = db();
  return await sql<ApiKeyRow[]>`
    SELECT id, name, prefix, created_at, last_used_at FROM weave_api_keys ORDER BY created_at DESC
  `;
}

/** Revoga (apaga) uma chave. */
export async function deleteApiKey(id: string): Promise<void> {
  const sql = db();
  await sql`DELETE FROM weave_api_keys WHERE id = ${id}`;
}

/** Valida a chave apresentada e carimba `last_used_at` (numa só query). */
export async function verifyApiKey(presented: string): Promise<boolean> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    UPDATE weave_api_keys SET last_used_at = now() WHERE key_hash = ${hashKey(presented)} RETURNING id
  `;
  return rows.length > 0;
}
