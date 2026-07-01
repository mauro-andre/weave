// Barrel público do @mauroandre/weave-core — a parte PURA do Weave (zero deps de
// banco): builders de schema, IR (planta serializável) + serialização, e
// inferência de tipos. Consumido pelo engine (servidor) e pelo SDK (client).

// ── Schema (builders + tipos Infer) ──────────────────────────────────────────
export * from "./schema/index.js";

// ── Linguagem de query tipada (filtro + ordenação) — compartilhada engine/GUI/SDK ──
export {
  type WhereInput,
  type OrderByInput,
  type SortDir,
  type Filter,
  type ArrayFilter,
} from "./schema/where.js";

// ── Linguagem de agregação tipada (idioma de objeto) — engine/GUI/SDK ──
export {
  type AggregateInput,
  type Accumulator,
  type AggOpts,
  type GroupExpr,
  type AggregateRow,
  count,
  sum,
  avg,
  min,
  max,
  distinct,
  percentile,
  timeBucket,
} from "./schema/aggregate.js";

// ── IR (planta serializável + serialização/validação) ────────────────────────
export * from "./ir/types.js";
export { toIR } from "./ir/to-ir.js";
export { fromIR } from "./ir/from-ir.js";
export { validateIR } from "./ir/validate.js";
export { normalizeEntityIR } from "./ir/normalize.js";
export { ensureFieldIds } from "./ir/ensure-ids.js";
export { resolveMirrors } from "./ir/resolve-mirrors.js";
export * from "./ir/diff.js";

// ── Catálogo de tipos PG (seletivo, como o engine index — evita clash com os
// construtores de coluna `int4()`/`text()` exportados pelo schema) ────────────
export {
  catalog,
  byName,
  byOid,
  allTypes,
  defineType,
  type CatalogName,
  type PgType,
  type PgTypeDef,
  type TsLabel,
  type Infer,
} from "./types/index.js";

// ── Util puro (slug, palavras reservadas, naming, inflect, uuid) ──────────────
export * from "./util/slug.js";
export * from "./util/reserved.js";
export * from "./util/inflect.js";
export * from "./util/naming.js";
export * from "./util/uuid.js";
