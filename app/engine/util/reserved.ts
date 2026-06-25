// Palavras reservadas do PostgreSQL que não podem ser usadas como identificador
// "pelado" (sem aspas). Como o Weave nunca escreve/mostra SQL e não faz quote de
// identificadores, esses nomes são bloqueados na validação com uma mensagem
// amigável — em vez de deixar estourar um erro de sintaxe SQL cru no usuário.
const RESERVED: ReadonlySet<string> = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
  "both", "case", "cast", "check", "collate", "column", "constraint", "create",
  "current_catalog", "current_date", "current_role", "current_time",
  "current_timestamp", "current_user", "default", "deferrable", "desc", "distinct",
  "do", "else", "end", "except", "false", "fetch", "for", "foreign", "from",
  "grant", "group", "having", "in", "initially", "intersect", "into", "lateral",
  "leading", "limit", "localtime", "localtimestamp", "not", "null", "offset", "on",
  "only", "or", "order", "placing", "primary", "references", "returning", "select",
  "session_user", "some", "symmetric", "table", "then", "to", "trailing", "true",
  "union", "unique", "user", "using", "variadic", "when", "where", "window", "with",
]);

export function isReserved(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}
