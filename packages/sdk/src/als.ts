import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type ClientOptions, type WeaveClient } from "./client.js";
import type { Entity, ShapeRecord } from "../../core/src/index.js";
import type { ScopeDef } from "./scope.js";

// Client AMBIENT pro caso multi-tenant: um AsyncLocalStorage guarda o client escopado do
// request; os entities resolvem por ele. FORA de qualquer `runAs`/`runAsGod` → DENY (throw),
// nunca god — FAIL-CLOSED por construção (esquecer/perder o contexto nega, não vaza). `node:
// async_hooks` fica isolado neste subpath (`@mauroandre/weave-sdk/als`) pra não impor ALS a
// quem não faz multi-tenancy. Aditivo: quem não importa daqui segue com o client de sempre.

/**
 * Levantado quando um entity é acessado FORA de um `runAs`/`runAsGod` no client ambient.
 * O caller (servidor HTTP do app) mapeia pra 401/403. Fail-closed: sem scope, nega.
 */
export class WeaveScopeError extends Error {
  constructor(
    message = "weave: no ambient scope in this context. Wrap the request in weave.runAs(scope, params, fn), " +
      "use weave.runAsGod(fn), or call weave.god.* for explicit full access (auth/boot/scripts).",
  ) {
    super(message);
    this.name = "WeaveScopeError";
  }
}

// deny-client: qualquer OPERAÇÃO estoura (o ACESSO ao entity não, pra não quebrar
// destructuring/inspeção) — o erro surge no ponto certo (a chamada `findMany()`/`create()`).
const denyOp = (): never => {
  throw new WeaveScopeError();
};
const denyEntity: unknown = new Proxy({}, { get: () => denyOp });
const denyClient: unknown = new Proxy({}, { get: () => denyEntity });

/** Client ambient: `runAs`/`runAsGod`/`god` + entities resolvidos pelo ALS (deny fora). */
export type AmbientClient<S extends Record<string, Entity<string, ShapeRecord>>> = WeaveClient<S> & {
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
};

/**
 * Cria um client AMBIENT sobre a mesma config do `createClient`. Os entities resolvem pelo
 * client escopado ativo (setado por `runAs`/`runAsGod` via AsyncLocalStorage); FORA de
 * qualquer run → DENY (throw), nunca god. `weave.god` expõe o god cru pra auth/boot.
 */
export function createAmbientClient<S extends Record<string, Entity<string, ShapeRecord>>>(
  options: ClientOptions<S>,
): AmbientClient<S> {
  const god = createClient(options);
  const als = new AsyncLocalStorage<WeaveClient<S>>();
  // `.as` aceita (scope, params); tipamos frouxo aqui (o tipo público está no AmbientClient).
  const asLoose = god.as as unknown as (scope: unknown, params?: unknown) => WeaveClient<S>;

  const runAs = (scope: ScopeDef<string> | string, a: unknown, b?: unknown): unknown => {
    const fn = (b ?? a) as () => unknown; // (scope, params, fn) | (scope, fn)
    const params = b !== undefined ? (a as Record<string, unknown>) : undefined;
    return als.run(asLoose(scope, params), fn);
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
  }) as AmbientClient<S>;
}
