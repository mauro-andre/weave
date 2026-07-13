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
// Client escopado (multi-tenant): `scopedWeave = createScopedClient(weave)` — request-scoped,
// fail-closed (deny fora de `runAs` → `WeaveScopeError`, exportado de ./errors). Node-only
// (`node:async_hooks`), server-side como o resto.
export { createScopedClient } from "./scoped.js";
export type { ScopedClient } from "./scoped.js";
export type { Infer, InferWhere, InferPatch, InferOrderBy, InferUpdate } from "./types.js";
export { pushEntities } from "./push.js";
export type { PushOptions, PushResult, MigrationPlan, PlanChange } from "./push.js";
// `pushAll` — push de PROJETO (entities + scopes) a partir de objetos em memória. É puro
// (só Request/fetch, sem `node:fs`), então mora aqui, ao lado de pushEntities/pushScopes:
// é chamado do servidor no boot loop, sem arrastar o CLI (runCli/argv/gen).
export { pushAll } from "./push-all.js";
export type { PushAllOptions, PushAllResult } from "./push-all.js";
export { defineConfig } from "./config.js";
export type { WeaveConfig } from "./config.js";
export { defineScope, scopeRule, pushScopes } from "./scope.js";
export type { ScopeDef, ScopeRule, ScopeRuleConfig, ScopeEntityRule, Verb, PushScopesOptions } from "./scope.js";
export { irToSource, scopeToSource, genProject, pullEntities, buildLazyRefPredicate } from "./gen.js";
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
  mirror,
  reference,
  self,
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
  first,
  percentile,
  histogram,
  div,
  mul,
  add,
  sub,
  timeBucket,
  // accumulate (escrita do tier histórico)
  inc,
  setOnInsert,
  type AccumulateOp,
  type AccumulateInput,
  type Entity,
  type InferEntity,
  type InferRead,
  type InferInsert,
  type WhereInput,
  type OrderByInput,
  type AggregateInput,
  type FacetInput,
  type AggregateOutput,
  type Accumulator,
  type AggOpts,
  type GroupExpr,
  type AggregateRow,
  type Expr,
  type ExprOperand,
} from "../../core/src/index.js";
