// @mauroandre/weave-sdk — a cola. Entities-as-code in, objetos tipados out, HTTP/JSON
// invisível. v1 (F1): createClient + CRUD tipado. Typed where (F2), entities.push +
// CLI (F3), scope-as-code/weave.as (F4) vêm depois.

export { createClient } from "./client.js";
export type {
  WeaveClient,
  EntityClient,
  ClientOptions,
  ReadOpts,
  PageOpts,
  PageResult,
  FetchLike,
} from "./client.js";
export type { Infer, InferUpdate } from "./types.js";
export { pushEntities } from "./push.js";
export type { PushOptions, PushResult, MigrationPlan, PlanChange } from "./push.js";
export { defineConfig } from "./config.js";
export type { WeaveConfig } from "./config.js";
export { defineScope, pushScopes } from "./scope.js";
export type { ScopeDef, ScopeEntityRule, Verb, PushScopesOptions } from "./scope.js";
export { irToSource, scopeToSource, genProject, pullEntities } from "./gen.js";
export type { IrToSourceOptions, GenOptions, GenProject } from "./gen.js";
export type { PullOptions } from "./gen.js";
export {
  WeaveError,
  WeaveAuthError,
  WeaveScopeError,
  WeaveNotFoundError,
  WeaveValidationError,
} from "./errors.js";

// Re-export do núcleo: o dev escreve o entities com os MESMOS builders do core
// (isomorfismo GUI ≡ código), e pode nomear os tipos de entidade quando precisar.
export {
  defineEntity,
  owned,
  reference,
  array,
  // construtores de coluna (escalares)
  int2,
  int4,
  int8,
  numeric,
  float4,
  float8,
  text,
  varchar,
  bpchar,
  timestamptz,
  timestamp,
  date,
  time,
  interval,
  bool,
  uuid,
  json,
  jsonb,
  bytea,
  // agregação (idioma de objeto)
  count,
  sum,
  avg,
  min,
  max,
  distinct,
  percentile,
  timeBucket,
  type Entity,
  type InferEntity,
  type InferRead,
  type InferInsert,
  type AggregateInput,
  type Accumulator,
  type AggOpts,
  type GroupExpr,
  type AggregateRow,
} from "@mauroandre/weave-core";
