import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { defineEntity, reference, text, weave, type Weave } from "../../app/engine/index.js";

// Garantia pro PodCubo (já em produção, schema criado): com a FK agora como ALTER
// (Peça 2), um RE-SYNC de schema existente tem que ser NO-OP — o diff introspecta as
// FKs por coluna e pula as que já existem. Se pulasse errado, o 2º sync tentaria
// `ADD CONSTRAINT` de novo e estouraria "já existe". Usa reference EAGER (o caso do
// PodCubo, acíclico), não thunk.

const noDb = process.env.WEAVE_NO_DB === "1";
const cat = defineEntity("fkidem_cat", { name: text().notNull() });
const prod = defineEntity("fkidem_prod", { title: text().notNull(), category: reference(cat) });
const tables = "fkidem_prod, fkidem_cat";

describe.skipIf(noDb)("FK idempotência — re-sync de schema existente é no-op", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url: DATABASE_URL, entities: { cat, prod } });
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
  });

  afterAll(async () => {
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.close();
  });

  const fkCount = async (): Promise<number> =>
    (
      await db.sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.table_constraints
        where constraint_type = 'FOREIGN KEY' and table_schema = 'public' and table_name = 'fkidem_prod'`
    )[0]!.n;

  it("1º sync cria a FK; 2º sync não re-adiciona (sem erro, sem duplicata)", async () => {
    const first = await db.sync();
    expect(first.created).toContain("fkidem_prod"); // criou as tabelas
    expect(await fkCount()).toBe(1); // FK criada (via ALTER)

    // 2º sync = o que o PodCubo faz ao subir a imagem nova sobre schema já existente.
    const second = await db.sync();
    expect(second.created).toEqual([]); // nada re-criado
    expect(await fkCount()).toBe(1); // FK intacta, NÃO duplicada, NÃO re-tentada
  });

  it("3º sync também é estável (idempotente de verdade)", async () => {
    await db.sync();
    expect(await fkCount()).toBe(1);
  });
});
