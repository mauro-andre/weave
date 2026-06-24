import { db } from "./db.js";
import { weave } from "../index.js";
import { validateIR } from "../ir/validate.js";
import { normalizeEntityIR } from "../ir/normalize.js";
import { fromIR } from "../ir/from-ir.js";
import type { EntityIR } from "../ir/types.js";

/** Lista as plantas (IR) guardadas no metastore. */
export async function listEntities(): Promise<EntityIR[]> {
  const sql = db();
  const rows = await sql<{ ir: EntityIR | string }[]>`SELECT ir FROM weave_entities ORDER BY name`;
  return rows.map((r) => parseIR(r.ir));
}

/** Lê a planta (IR) de uma entidade pelo nome (ou null se não existir). */
export async function getEntity(name: string): Promise<EntityIR | null> {
  const sql = db();
  const rows = await sql<{ ir: EntityIR | string }[]>`SELECT ir FROM weave_entities WHERE name = ${name}`;
  return rows[0] ? parseIR(rows[0].ir) : null;
}

function parseIR(ir: EntityIR | string): EntityIR {
  return typeof ir === "string" ? (JSON.parse(ir) as EntityIR) : ir;
}

/**
 * Grava a planta no metastore e **materializa** as tabelas reais (reusa o
 * `sync()` do engine). Valida o IR antes; lança em IR inválido.
 */
export async function saveEntity(input: unknown): Promise<EntityIR> {
  const ir = normalizeEntityIR(validateIR(input));
  const sql = db();
  await sql`
    INSERT INTO weave_entities (name, ir)
    VALUES (${ir.name}, ${JSON.stringify(ir)}::jsonb)
    ON CONFLICT (name) DO UPDATE SET ir = EXCLUDED.ir, updated_at = now()
  `;
  await materialize();
  return ir;
}

/** Materializa todas as entidades do metastore no banco (aditivo, via sync). */
async function materialize(): Promise<void> {
  const entities = fromIR(await listEntities());
  const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("weave: DATABASE_URL is not set.");
  const client = weave({ url, entities });
  try {
    await client.sync();
  } finally {
    await client.close();
  }
}
