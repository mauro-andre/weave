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

/** Deterministic name for a single-column index: `users_email_idx`. */
export function indexName(table: string, column: string): string {
  return `${table}_${column}_idx`;
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
