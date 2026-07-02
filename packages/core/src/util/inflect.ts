/**
 * Identifier-path helper for naming conventions. (No pluralization heuristic — the
 * owned/FK naming derives directly from the entity/path, without singularizing.)
 */

/** The last `_`-separated segment of an identifier (`user_addresses` → `addresses`). */
export function lastSegment(name: string): string {
  const parts = name.split("_");
  return parts[parts.length - 1] ?? name;
}
