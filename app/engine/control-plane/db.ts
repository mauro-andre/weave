import postgres from "postgres";

// Conexão lazy com o control plane (mesma base `weave`, tabelas prefixadas weave_*).
let sql: ReturnType<typeof postgres> | null = null;

export function db(): ReturnType<typeof postgres> {
  if (!sql) {
    const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("weave: DATABASE_URL is not set.");
    sql = postgres(url);
  }
  return sql;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}
