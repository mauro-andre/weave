import postgres from "postgres";
import { config } from "dotenv";

// Roda UMA vez antes de toda a sessão de testes (vitest globalSetup). Zera o
// banco de teste — dropa todas as tabelas do schema public — pra cada execução
// começar do absoluto zero, sem resíduo de rodadas anteriores. As tabelas de
// control-plane (weave_users/weave_entities) são recriadas pelo `setup()` no
// beforeAll de cada arquivo.
//
// FONTE ÚNICA da URL do banco: o `.env` (DATABASE_URL), o mesmo que o dev usa.
// Troque a porta/host SÓ lá. Aqui só carregamos o .env (dotenv) e reexportamos
// como string garantida — os dois vitest configs e os testes do driver/cli
// importam esta const, então ninguém repete a URL.
config();
if (!process.env.DATABASE_URL) {
  throw new Error("weave: DATABASE_URL não definido — configure no .env");
}
export const DATABASE_URL = process.env.DATABASE_URL;

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
