import { db } from "./db.js";
import { hashPassword } from "./crypto.js";

// Prepara o control plane: cria as tabelas weave_* (se não existirem) e semeia o
// master a partir do .env quando weave_users está vazia. Idempotente — seguro em
// todo boot e no bootstrap dos testes.
export async function setup(): Promise<void> {
  const sql = db();

  await sql`
    CREATE TABLE IF NOT EXISTS weave_users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username      text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Metastore das entidades: a planta (IR) de cada entidade, em jsonb.
  await sql`
    CREATE TABLE IF NOT EXISTS weave_entities (
      name        text PRIMARY KEY,
      ir          jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Chaves da API REST: guardamos só o hash (sha256); o texto aparece 1x na criação.
  await sql`
    CREATE TABLE IF NOT EXISTS weave_api_keys (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name          text NOT NULL,
      key_hash      text NOT NULL UNIQUE,
      prefix        text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      last_used_at  timestamptz
    )
  `;

  // Scopes: políticas nomeadas (por entidade: verbos + filtro-de-linhas + projeção),
  // guardando os campos por **id** (à prova de rename). Escolhidos por requisição
  // via header `x-weave-scope`; sem scope = god.
  await sql`
    CREATE TABLE IF NOT EXISTS weave_scopes (
      name        text PRIMARY KEY,
      def         jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Pending de migração: UM slot só (id=1). Um `applyProject` que retém guarda aqui o
  // desejado + os held; a resolução na GUI lê e aplica. Last-writer-wins (o próximo
  // push sobrescreve). Ver control-plane/pending.ts.
  await sql`
    CREATE TABLE IF NOT EXISTS weave_pending (
      id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM weave_users`;
  if (row && row.count === 0) {
    const username = process.env.MASTER_USERNAME;
    const password = process.env.MASTER_PASSWORD;
    if (username && password) {
      await sql`
        INSERT INTO weave_users (username, password_hash)
        VALUES (${username}, ${hashPassword(password)})
      `;
    }
  }
}
