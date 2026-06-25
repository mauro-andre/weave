import { db } from "./db.js";
import type { Filter } from "./filter.js";

// Um scope é uma política nomeada. Por entidade: verbos permitidos + filtro de
// linhas + projeção. Os campos são guardados por **id** (não nome) — à prova de
// rename; resolvidos pra nomes no enforcement.

export type Verb = "read" | "create" | "update" | "delete";

// Mesma árvore do Filter, mas os `path` das condições são **ids de campo**, e os
// valores podem ser literais ou `{ param: "x" }` (preenchidos por requisição).
export type ScopeFilter = Filter;

export interface Projection {
  mode: "include" | "exclude";
  /** Cada path é uma lista de ids de campo (1 = topo; ≥2 = aninhado em owned/ref). */
  paths: string[][];
}

export interface EntityRule {
  verbs: Verb[];
  rows: ScopeFilter | null;
  fields: Projection | null; // null = todos
}

export interface Scope {
  name: string;
  entities: Record<string, EntityRule>;
}

function parseScope(name: string, def: unknown): Scope {
  const d = (typeof def === "string" ? JSON.parse(def) : def) as { entities?: Record<string, EntityRule> };
  return { name, entities: d.entities ?? {} };
}

export async function listScopes(): Promise<Scope[]> {
  const sql = db();
  const rows = await sql<{ name: string; def: unknown }[]>`SELECT name, def FROM weave_scopes ORDER BY name`;
  return rows.map((r) => parseScope(r.name, r.def));
}

export async function getScope(name: string): Promise<Scope | null> {
  const sql = db();
  const rows = await sql<{ name: string; def: unknown }[]>`SELECT name, def FROM weave_scopes WHERE name = ${name}`;
  return rows[0] ? parseScope(rows[0].name, rows[0].def) : null;
}

export async function saveScope(scope: Scope): Promise<void> {
  const sql = db();
  const def = JSON.stringify({ entities: scope.entities });
  await sql`
    INSERT INTO weave_scopes (name, def) VALUES (${scope.name}, ${def}::jsonb)
    ON CONFLICT (name) DO UPDATE SET def = EXCLUDED.def, updated_at = now()
  `;
}

export async function deleteScope(name: string): Promise<void> {
  const sql = db();
  await sql`DELETE FROM weave_scopes WHERE name = ${name}`;
}
