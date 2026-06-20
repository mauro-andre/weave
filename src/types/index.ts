export type { PgType, PgTypeDef, TsLabel } from "./pg-type.js";
export { defineType, type Infer } from "./pg-type.js";
export * from "./catalog.js";
export { catalog, allTypes, byName, byOid, type CatalogName } from "./registry.js";
