/**
 * Naming helpers shared by the DDL and query layers.
 */

import { lastSegment, singularize } from "./inflect.js";

/**
 * Convert a camelCase identifier to snake_case.
 *
 * `lastSeen` → `last_seen`, `createdAt` → `created_at`. A leading underscore
 * (from a capitalized first letter) is trimmed.
 */
export function camelToSnake(name: string): string {
  return name
    .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    .replace(/^_/, "");
}

/**
 * Nome LÓGICO de um campo, em camelCase canônico. Aceita qualquer estilo de entrada
 * (espaços, camelCase, snake_case, kebab, acentos) e converge pro MESMO identificador
 * — do qual a coluna do Postgres deriva via `camelToSnake` (snake_case, o idioma do PG).
 *
 * `"First Name"` / `"first_name"` / `"firstName"` → `"firstName"` → coluna `first_name`.
 * `"nome do campo"` → `"nomeDoCampo"` → coluna `nome_do_campo`.
 */
export function camelize(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas combinantes)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // separa a corcunda camelCase
    .split(/[^A-Za-z0-9]+/) // separa por qualquer não-alfanumérico
    .filter(Boolean);
  if (words.length === 0) return "";
  const camel = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  return /^[0-9]/.test(camel) ? `_${camel}` : camel; // identificador não começa com dígito
}

/** Deterministic name for a single-column index: `users_email_idx`. */
export function indexName(table: string, column: string): string {
  return `${table}_${column}_idx`;
}

/**
 * Nome de TABELA/armazenamento de uma ENTITY: `camelize` (nome lógico canônico) →
 * `camelToSnake`. Espelha o tratamento dos campos no nível da entity — `backupStorages`
 * → tabela `backup_storages`, enquanto o SDK preserva o `backupStorages` lógico.
 * Idempotente pra nomes já em snake/uma-palavra (`category` → `category`).
 */
export function tableize(name: string): string {
  return camelToSnake(camelize(name));
}

/**
 * Nome determinístico de um índice COMPOSTO (várias colunas). `unique` → sufixo
 * `_key`; senão `_idx`. Recebe as colunas JÁ resolvidas (snake_case). Estável: o
 * diff dropa por este mesmo nome. (Postgres trunca em 63 chars — colisão em nomes
 * gigantes é aceita no v1.)
 */
export function compositeIndexName(table: string, columns: string[], unique: boolean): string {
  return `${table}_${columns.join("_")}_${unique ? "key" : "idx"}`;
}

/**
 * Child table name for an owned relationship. The ownership path is joined with
 * a **double** underscore so it stays unambiguous even when names contain `_`:
 * `("user", "addresses")` → `user__addresses`. `override` wins when given.
 */
export function ownedChildTable(
  pathPrefix: string,
  fieldSnake: string,
  override?: string,
): string {
  return override ?? `${pathPrefix}__${fieldSnake}`;
}

/**
 * FK column a child uses to point at its parent, from the parent's path prefix.
 * `"user"` → `user_id`; `"user_addresses"` → `address_id`.
 */
export function ownedFkColumn(parentPathPrefix: string): string {
  return `${singularize(lastSegment(parentPathPrefix))}_id`;
}

/** Join table for an N:N reference (path joined with `__`): `("user", "cities")` → `user__cities`. */
export function joinTableName(pathPrefix: string, fieldSnake: string): string {
  return `${pathPrefix}__${fieldSnake}`;
}

/** Join-table FK to the target, from the (snake) field: `"cities"` → `city_id`. */
export function joinTargetFk(fieldSnake: string): string {
  return `${singularize(fieldSnake)}_id`;
}
