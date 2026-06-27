// @mauroandre/weave-sdk — a cola. Schema-as-code in, objetos tipados out, HTTP/JSON
// invisível. v1 (F1): createClient + CRUD tipado. Typed where (F2), schema.push +
// CLI (F3), scope-as-code/weave.as (F4) vêm depois.

export { createClient } from "./client.js";
export type {
  WeaveClient,
  EntityClient,
  ClientOptions,
  FindArgs,
  PageResult,
  FetchLike,
} from "./client.js";
export type { Infer, InferUpdate } from "./types.js";
export { pushSchema } from "./push.js";
export type { PushOptions, PushResult, MigrationPlan, PlanChange } from "./push.js";
export { defineConfig } from "./config.js";
export type { WeaveConfig } from "./config.js";
export {
  WeaveError,
  WeaveAuthError,
  WeaveScopeError,
  WeaveNotFoundError,
  WeaveValidationError,
} from "./errors.js";

// Re-export do núcleo: o dev escreve o schema com os MESMOS builders do core
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
  type Entity,
  type InferEntity,
  type InferRead,
  type InferInsert,
} from "@mauroandre/weave-core";
