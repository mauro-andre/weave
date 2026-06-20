/**
 * Naming helpers shared by the DDL layer.
 */

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
