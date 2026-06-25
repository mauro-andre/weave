import postgres from "postgres";

// Roda UMA vez antes de toda a sessão de testes (vitest globalSetup). Zera o
// banco de teste — dropa todas as tabelas do schema public — pra cada execução
// começar do absoluto zero, sem resíduo de rodadas anteriores. As tabelas de
// control-plane (weave_users/weave_entities) são recriadas pelo `setup()` no
// beforeAll de cada arquivo.
//
// IMPORTANTE: esta URL deve bater com `test.env.DATABASE_URL` do vitest.config.
// O globalSetup não herda o `test.env` (que só vale dentro dos workers), por
// isso é literal aqui.
const DATABASE_URL = "postgres://weave:weave@localhost:5432/weave";

export async function setup(): Promise<void> {
  const sql = postgres(DATABASE_URL, { onnotice: () => {} }); // silencia NOTICEs do CASCADE
  try {
    await sql`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `;
  } finally {
    await sql.end();
  }
}
