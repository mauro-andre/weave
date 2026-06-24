import { db } from "./db.js";

export interface WeaveUser {
  id: string;
  username: string;
  password_hash: string;
}

export async function findUserByUsername(username: string): Promise<WeaveUser | null> {
  const sql = db();
  const rows = await sql<WeaveUser[]>`
    SELECT id, username, password_hash FROM weave_users WHERE username = ${username}
  `;
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<WeaveUser | null> {
  const sql = db();
  const rows = await sql<WeaveUser[]>`
    SELECT id, username, password_hash FROM weave_users WHERE id = ${id}
  `;
  return rows[0] ?? null;
}
