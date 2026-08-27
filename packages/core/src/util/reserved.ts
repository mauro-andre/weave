// Palavras mais reservadas do PostgreSQL, bloqueadas na validação com mensagem
// amigável. HOJE toda a SQL do Weave cita identificadores (`qi` — um campo `join`
// funciona sem renomear), então esta lista não é mais a barreira técnica: é defesa
// em profundidade contra os nomes mais confusos de se ver em mensagens, GUI e
// storage (`where`, `order`, `select`…). Palavras fora dela (ex.: `join`, `left`)
// seguem funcionando graças ao quoting.
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
