import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Entity, ShapeRecord } from "@mauroandre/weave-core";

// Descoberta por pasta (file-based, igual o VeloJS acha rotas): cada arquivo é uma
// entidade, exportada como `default`. Node-only (usa fs) — fora do barrel do SDK.

/** Importa um módulo por caminho absoluto. Injetável (a CLI usa um loader de TS). */
export type ModuleLoader = (absPath: string) => Promise<{ default?: unknown }>;

const isEntity = (v: unknown): v is Entity<string, ShapeRecord> =>
  !!v && typeof v === "object" && "name" in v && "columns" in v;

/**
 * Lê a pasta de entidades, importa o `default` de cada arquivo, e monta o objeto
 * `entities` chaveado pelo nome da entidade — o mesmo que o `pushEntities`/`createClient`
 * consomem. Ignora arquivos sem `export default defineEntity(...)`.
 */
export async function discoverEntities(
  entitiesDir: string,
  load: ModuleLoader = (p) => import(pathToFileURL(p).href),
): Promise<Record<string, Entity<string, ShapeRecord>>> {
  const files = (await fs.readdir(entitiesDir))
    .filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f) && !f.endsWith(".d.ts"))
    .sort();

  const entities: Record<string, Entity<string, ShapeRecord>> = {};
  for (const f of files) {
    const mod = await load(path.resolve(entitiesDir, f));
    if (isEntity(mod.default)) entities[mod.default.name] = mod.default;
  }
  return entities;
}
