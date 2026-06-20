// Public shape-declaration API: column constructors, array(), defineEntity.
export * from "./schema/index.js";

// DDL emission (shape → CREATE TABLE / CREATE INDEX).
export * from "./ddl/index.js";

// Driver: connection, transaction, sync().
export * from "./driver/index.js";

// Catalog metadata (the raw PgType objects live under `catalog.*`, not at top
// level, to avoid clashing with the `int4()` / `text()` column constructors).
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
