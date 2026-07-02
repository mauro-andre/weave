export {
  compileFind,
  compileCount,
  compileAggregate,
  type FindOptions,
  type CompiledQuery,
} from "./read.js";
// WhereInput/OrderByInput/SortDir/Filter/ArrayFilter agora vivem no core e chegam
// na fachada do engine via `export * from "@mauroandre/weave-core"` (não reexporta
// aqui pra não duplicar o re-export).
export { rehydrate } from "./rehydrate.js";
export type { ExpandMap, SelectMap } from "./read.js";
export { shred, renderInsert, renderUpsert, type Executor } from "./write.js";
export { compileAccumulate, type CompiledAccumulate } from "./accumulate.js";
