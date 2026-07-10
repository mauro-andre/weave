/**
 * Naming helpers shared by the DDL and query layers.
 */

import { lastSegment } from "./inflect.js";

/** Limite de identificador do Postgres (NAMEDATALEN-1). Acima disso, o PG trunca em silêncio. */
const MAX_IDENT = 63;

/** Hash FNV-1a 32-bit → 8 hex. Determinístico e puro (sem crypto) — estável entre pushes. */
function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Nome de índice/constraint (identificador-FOLHA) que cabe em 63 chars sem colidir.
 * Natural: `<table>_<tail>_<suffix>`. Se estoura, inverte pra `<tail>_<hash(table)>_<suffix>`
 * — a tabela vira um hash de 8 chars (o índice aparece listado SOB ela no `\d`, então não
 * se perde nada), e o `tail` (coluna) + o `suffix` (`_idx`/`_fkey`/`_key`) ficam legíveis. O
 * hash da tabela garante unicidade schema-wide. Sem leading separator. No-op pra quem cabe.
 */
function leafIdent(table: string, tail: string, suffix: string): string {
  const natural = `${table}_${tail}_${suffix}`;
  if (natural.length <= MAX_IDENT) return natural;
  const compact = `${tail}_${hash8(table)}_${suffix}`;
  if (compact.length <= MAX_IDENT) return compact;
  // Patológico: o próprio `tail` (coluna/colunas) já estoura — trunca o tail, mantém o hash
  // do nome INTEIRO (unicidade) e o suffix. Raríssimo (coluna de ~50+ chars).
  const room = MAX_IDENT - 1 - 8 - 1 - suffix.length;
  return `${tail.slice(0, Math.max(1, room))}_${hash8(natural)}_${suffix}`;
}

/**
 * Nome de TABELA (caminho de owned, segmentos com `__`) que cabe em 63. Natural:
 * `<prefix>__<field>`. Se estoura, colapsa pra `<root>__<hash(caminho inteiro)>__<field>`
 * — `root` (a entity) e `field` (o owned leaf) legíveis; o hash do caminho TODO distingue
 * trilhas com mesmo root+leaf. Preservar o `field` mantém a FK do filho derivando igual
 * (`ownedFkColumn` usa o último segmento). Sem leading separator. No-op pra quem cabe.
 */
function pathIdent(prefix: string, field: string): string {
  const natural = `${prefix}__${field}`;
  if (natural.length <= MAX_IDENT) return natural;
  const root = prefix.split("__")[0] ?? prefix; // a entity (1º segmento do caminho)
  const collapsed = `${root}__${hash8(natural)}__${field}`;
  if (collapsed.length <= MAX_IDENT) return collapsed;
  // Patológico: root+field já estoura sozinho — trunca o field. Raríssimo.
  const room = MAX_IDENT - root.length - 2 - 8 - 2;
  return `${root}__${hash8(natural)}__${field.slice(0, Math.max(1, room))}`;
}

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

/** Deterministic name for a single-column index: `users_email_idx`. Clampa se > 63 chars. */
export function indexName(table: string, column: string): string {
  return leafIdent(table, column, "idx");
}

/** Deterministic FK constraint name: `users_city_id_fkey`. Clampa se > 63 chars. */
export function fkConstraintName(table: string, column: string): string {
  return leafIdent(table, column, "fkey");
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
  return leafIdent(table, columns.join("_"), unique ? "key" : "idx");
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
  return override ?? pathIdent(pathPrefix, fieldSnake);
}

/**
 * FK column a child uses to point at its parent, from the parent's path prefix
 * (the last `_`-segment + `_id`). `"apps"` → `apps_id`; `"apps__detected_volumes"`
 * → `volumes_id`. No pluralization heuristic — the name is derived as-is.
 */
export function ownedFkColumn(parentPathPrefix: string): string {
  return `${lastSegment(parentPathPrefix)}_id`;
}

/** Join table for an N:N reference (path joined with `__`): `("user", "cities")` → `user__cities`. Clampa se > 63. */
export function joinTableName(pathPrefix: string, fieldSnake: string): string {
  return pathIdent(pathPrefix, fieldSnake);
}

/** Join-table FK to the target, from the (snake) field: `"cities"` → `cities_id`. */
export function joinTargetFk(fieldSnake: string): string {
  return `${fieldSnake}_id`;
}
