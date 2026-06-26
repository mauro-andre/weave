/**
 * Minimal English inflection — just enough for naming conventions.
 *
 * Used to derive the FK column name from a parent's path segment
 * (`users` → `user_id`, `addresses` → `address_id`).
 */

/** Singularize a (lowercase) identifier with a few common rules. */
export function singularize(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, "y"); // cities → city
  if (/(s|x|z|ch|sh)es$/i.test(word)) return word.replace(/es$/i, ""); // boxes → box, addresses → address
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.replace(/s$/i, ""); // users → user
  return word;
}

/** The last `_`-separated segment of an identifier (`user_addresses` → `addresses`). */
export function lastSegment(name: string): string {
  const parts = name.split("_");
  return parts[parts.length - 1] ?? name;
}
