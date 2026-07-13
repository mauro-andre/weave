import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type ClientOptions, type WeaveClient } from "./client.js";
import { WeaveScopeError } from "./errors.js";
import type { Entity, ShapeRecord } from "../../core/src/index.js";
import type { ScopeDef } from "./scope.js";

// Client ESCOPADO pro caso multi-tenant: um AsyncLocalStorage guarda o client escopado do
// request; os entities resolvem por ele. FORA de qualquer `runAs`/`runAsGod` → DENY (throw),
// nunca god — FAIL-CLOSED por construção (esquecer/perder o contexto nega, não vaza). É o
// par do `createClient`: `weave` (god, boot/infra) + `scopedWeave` (request, fail-closed).

// deny-client: qualquer OPERAÇÃO estoura (o ACESSO ao entity não, pra não quebrar
// destructuring/inspeção) — o erro surge no ponto certo (a chamada `findMany()`/`create()`).
// Reusa `WeaveScopeError` (o mesmo 403 do enforcement): acessar sem scope = negado.
const denyOp = (): never => {
  throw new WeaveScopeError(
    "weave: no scope in this context. Wrap the request in scopedWeave.runAs(scope, params, fn), " +
      "use scopedWeave.runAsGod(fn), or use the plain `weave` client for full access (auth/boot/scripts).",
  );
};
const denyEntity: unknown = new Proxy({}, { get: () => denyOp });
const denyClient: unknown = new Proxy({}, { get: () => denyEntity });

/**
 * Uma regra de dispatch: amarra um `scope` a um predicado `when(principal)` e a um
 * extrator `params(principal)`. `when`/`params` são PUROS e SÍNCRONOS sobre o principal
 * em memória (decisão de dispatch, roda a cada request — sem I/O/await). Dado que não
 * está no token (ex.: departmentIds) entra no principal na AUTENTICAÇÃO, não aqui.
 */
export interface DispatchRule<P> {
  scope: ScopeDef<string>;
  when: (principal: P) => boolean;
  params?: (principal: P) => Record<string, unknown>;
}

/** Client escopado: `runAs`/`runAsGod`/`god`/`dispatcher` + entities resolvidos pelo ALS (deny fora). */
export type ScopedClient<S extends Record<string, Entity<string, ShapeRecord>>> = WeaveClient<S> & {
  /** O client god cru (auth PRÉ-scope, boot, ETL, scripts) — não passa pelo ALS. */
  readonly god: WeaveClient<S>;
  /** Estabelece o scope pro callback (sync/async), devolve o retorno de `fn`. Params
   *  exigidos/tipados quando o scope infere `{ param }`; scope sem params dispensa o objeto. */
  runAs<P extends string, R>(
    scope: ScopeDef<P>,
    ...rest: [P] extends [never] ? [fn: () => R] : [params: { [K in P]: unknown }, fn: () => R]
  ): R;
  /** God EXPLÍCITO pro callback (master, ou uma op cross-tenant consciente dentro de request). */
  runAsGod<R>(fn: () => R): R;
  /**
   * Constrói um dispatcher a partir de uma tabela `[{ scope, when, params? }]`: devolve um
   * callable `(principal, fn)` que roda `fn` sob o **1º** scope cujo `when(principal)` é true
   * (params via `params(principal)`). **First-match pela ordem** — overlaps são intencionais
   * e resolvem por ordem (mais específico primeiro; ex.: `department` acima de `admin`).
   * Nenhum casa → **deny** (`WeaveScopeError`, fail-closed). A tabela mora no APP (config sua,
   * gen-safe) e é tipada pelo principal `P` — mata o if-chain de role→scope sem nada
   * client-side no arquivo que o gen sobrescreve.
   */
  dispatcher<P>(rules: ReadonlyArray<DispatchRule<P>>): <R>(principal: P, fn: () => R) => R;
};

function isClient<S extends Record<string, Entity<string, ShapeRecord>>>(
  base: WeaveClient<S> | ClientOptions<S>,
): base is WeaveClient<S> {
  return typeof (base as { as?: unknown }).as === "function";
}

/**
 * Cria um client ESCOPADO. Aceita um client god JÁ criado (`createScopedClient(weave)` —
 * COMPARTILHA a base, então `scopedWeave.god === weave`) ou as options (cria a base). Os
 * entities resolvem pelo client escopado ativo (setado por `runAs`/`runAsGod` via
 * AsyncLocalStorage); FORA de qualquer run → DENY (throw), nunca god.
 */
export function createScopedClient<S extends Record<string, Entity<string, ShapeRecord>>>(
  base: WeaveClient<S> | ClientOptions<S>,
): ScopedClient<S> {
  const god = isClient(base) ? base : createClient(base);
  const als = new AsyncLocalStorage<WeaveClient<S>>();
  // `.as` aceita (scope, params); tipamos frouxo aqui (o tipo público está no ScopedClient).
  const asLoose = god.as as unknown as (scope: unknown, params?: unknown) => WeaveClient<S>;

  const runAs = (scope: ScopeDef<string> | string, a: unknown, b?: unknown): unknown => {
    const fn = (b ?? a) as () => unknown; // (scope, params, fn) | (scope, fn)
    const params = b !== undefined ? (a as Record<string, unknown>) : undefined;
    return als.run(asLoose(scope, params), fn);
  };

  const dispatcher =
    (rules: ReadonlyArray<DispatchRule<unknown>>) =>
    (principal: unknown, fn: () => unknown): unknown => {
      // FIRST-MATCH pela ordem da lista (convenção: mais específico primeiro). Overlaps são
      // INTENCIONAIS e resolvidos por ordem — ex.: uma regra `department` acima do `admin`
      // comum vence pro usuário com departamento, sem tocar na regra do admin.
      const chosen = rules.find((rule) => rule.when(principal));
      // Nenhum casou → deny (fail-closed, o mesmo WeaveScopeError de estar fora de runAs).
      if (!chosen) throw new WeaveScopeError("weave: no scope matches this principal — access denied.");
      return als.run(asLoose(chosen.scope, chosen.params?.(principal)), fn);
    };

  return new Proxy(god as object, {
    get(target, prop, recv) {
      if (typeof prop !== "string") return Reflect.get(target, prop, recv); // símbolos → god
      switch (prop) {
        case "god":
          return god;
        case "runAs":
          return runAs;
        case "runAsGod":
          return (fn: () => unknown) => als.run(god, fn);
        case "dispatcher":
          return dispatcher;
        case "as":
        case "close":
        case "reset":
          return Reflect.get(target, prop, recv); // escopo/infra explícitos (não-ambient)
        default: {
          // acesso a entity → client escopado ativo, ou DENY fora de qualquer run.
          const active = (als.getStore() ?? (denyClient as WeaveClient<S>)) as Record<string, unknown>;
          return active[prop];
        }
      }
    },
  }) as ScopedClient<S>;
}
