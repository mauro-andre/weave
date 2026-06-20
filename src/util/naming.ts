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
 * Child table name for an owned relationship.
 * `("user", "addresses")` → `user_addresses`; `override` wins when given.
 */
export function ownedChildTable(
  pathPrefix: string,
  fieldSnake: string,
  override?: string,
): string {
  return override ?? `${pathPrefix}_${fieldSnake}`;
}

/**
 * FK column a child uses to point at its parent, from the parent's path prefix.
 * `"user"` → `user_id`; `"user_addresses"` → `address_id`.
 */
export function ownedFkColumn(parentPathPrefix: string): string {
  return `${singularize(lastSegment(parentPathPrefix))}_id`;
}
