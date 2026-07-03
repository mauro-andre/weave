import { db } from "./db.js";
import { setup } from "./setup.js";
import { __resetPartitionCache } from "./partition.js";

// Factory reset — **dev/test only**. Devolve o banco a um Postgres virgem: dropa
// TODAS as tabelas do schema public (dados, tabelas de entity, owned/join/partições,
// e o próprio metastore weave_*), depois recria o metastore vazio. Um `weave push`
// em seguida reconstrói o schema do zero a partir do entities-as-code.
//
// A trava de segurança NÃO vive aqui — é o handler que exige `WEAVE_DEV_MODE`. Esta
// função é o "botão nuclear" puro; quem pode apertá-lo é decidido na borda.
export async function factoryReset(): Promise<void> {
  const sql = db();

  // Mesmo wipe do global-setup dos testes: dropa cada tabela de public (CASCADE
  // leva owned/join/partições junto). Não enumera entity por entity — total e simples.
  await sql.unsafe(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  // Recria o metastore weave_* (idempotente) + re-semeia o master do env. A god-key
  // de env (WEAVE_API_KEY) autentica sem linha no banco, então o push pós-reset entra.
  await setup();

  // O cache in-memory de partições referencia gavetas que acabaram de sumir — zera
  // pra o próximo write recriá-las do zero (senão pularia o CREATE achando que existem).
  __resetPartitionCache();
}
