// Núcleo puro (builders + IR + tipos + catálogo): reexportado do @mauroandre/weave-core.
// Mantém a superfície pública do engine intacta — quem importava daqui não muda.
export * from "@mauroandre/weave-core";

// DDL emission (shape → CREATE TABLE / CREATE INDEX).
export * from "./ddl/index.js";

// Query: read compiler (weave) + rehydration.
export * from "./query/index.js";

// Driver: connection, transaction, sync(), find().
export * from "./driver/index.js";
