import type {
  Entity,
  ShapeRecord,
  InferEntity,
  InferInsert,
  InferRead,
  ExpandInput,
  WhereInput,
  OrderByInput,
} from "@mauroandre/weave-core";
import { reviveShape } from "./serialize.js";
import { errorFor } from "./errors.js";

/** Função de transporte: recebe um `Request`, devolve um `Response` (WHATWG fetch).
 *  Aceita retorno síncrono ou Promise (o `app.hono.fetch` pode ser síncrono). */
export type FetchLike = (request: Request) => Response | Promise<Response>;

export interface ClientOptions<S> {
  /** Base URL do Weave (ex.: `https://weave.minha-loja.com`). */
  url: string;
  /** API key (`x-api-key`). */
  key: string;
  /** O entities-as-code: `{ nome: defineEntity(...) }`. */
  entities: S;
  /** Transporte. Default: `globalThis.fetch`. Nos testes: `app.hono.fetch`. */
  fetch?: FetchLike;
  /** @internal — scope ativo (`x-weave-scope`), definido via `weave.as(...)`. */
  scope?: string;
  /** @internal — params do scope (`x-weave-params`). */
  params?: Record<string, unknown>;
}

/**
 * Opções de leitura, todas **tipadas pela entidade**: `where` (`WhereInput`),
 * `orderBy` (`OrderByInput`), e `expand` (`ExpandInput`) que ainda **dirige o tipo
 * do retorno** (`InferRead<E, X>`). Mesmo idioma do engine e da GUI.
 */
export interface FindArgs<E extends Entity<string, ShapeRecord>, X> {
  where?: WhereInput<E>;
  orderBy?: OrderByInput<E>;
  expand?: X & ExpandInput<E>;
  page?: number;
  perPage?: number;
}

export interface PageResult<T> {
  docs: T[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

/**
 * Client tipado de UMA entidade. Os reads se **auto-tipam pelo `expand`** que você
 * passa (`const X`), então `find({ expand: { category: true } })` já devolve o
 * objeto com `category` expandido e tipado — sem escrever nenhum `Infer`.
 */
export interface EntityClient<E extends Entity<string, ShapeRecord>> {
  create(input: InferInsert<E>): Promise<InferEntity<E>>;
  get<const X = {}>(
    id: string,
    opts?: { expand?: X & ExpandInput<E> },
  ): Promise<InferRead<E, X> | null>;
  find<const X = {}>(opts?: FindArgs<E, X>): Promise<InferRead<E, X>[]>;
  findOne<const X = {}>(opts?: FindArgs<E, X>): Promise<InferRead<E, X> | null>;
  paginate<const X = {}>(opts?: FindArgs<E, X>): Promise<PageResult<InferRead<E, X>>>;
  update(id: string, patch: Partial<InferInsert<E>>): Promise<InferEntity<E>>;
  delete(id: string): Promise<void>;
}

/** O client completo: uma propriedade por entidade do entities + `as` (scope). */
export type WeaveClient<S extends Record<string, Entity<string, ShapeRecord>>> = {
  [K in keyof S]: EntityClient<S[K]>;
} & {
  /** Client escopado: toda requisição leva `x-weave-scope` + `x-weave-params`. */
  as(scope: string, params?: Record<string, unknown>): WeaveClient<S>;
};

interface ListResponse {
  docs?: Record<string, unknown>[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

// Forma frouxa das opções, usada SÓ na implementação (a interface dá os tipos).
type AnyArgs = { where?: unknown; orderBy?: unknown; expand?: unknown; page?: number; perPage?: number };

/**
 * Cria o client tipado a partir do entities-as-code. Casca fina sobre a API HTTP do
 * Weave: monta o request, manda o `x-api-key`, revive `obj↔json` (datas) pela forma
 * da entidade, e serializa o `expand` no param. O `fetch` é injetável — em teste,
 * `app.hono.fetch`.
 */
export function createClient<S extends Record<string, Entity<string, ShapeRecord>>>(
  options: ClientOptions<S>,
): WeaveClient<S> {
  const transport: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req));
  const base = options.url.replace(/\/$/, "");

  async function request(
    method: string,
    path: string,
    opts: { query?: Record<string, string | undefined>; body?: unknown; allowNull?: boolean } = {},
  ): Promise<unknown> {
    let url = `${base}${path}`;
    if (opts.query) {
      const qs = Object.entries(opts.query)
        .filter((e): e is [string, string] => e[1] !== undefined)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = { "x-api-key": options.key };
    if (options.scope) {
      headers["x-weave-scope"] = options.scope;
      if (options.params) headers["x-weave-params"] = JSON.stringify(options.params);
    }
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const res = await transport(new Request(url, init));
    if (res.status === 404 && opts.allowNull) return null;
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const m =
        json && typeof json === "object" && "error" in json
          ? String((json as { error: unknown }).error)
          : `Weave request failed (${res.status}).`;
      throw errorFor(res.status, m);
    }
    return json;
  }

  // `where` e `expand` vão SEMPRE (default `{}`): `where={}` força o caminho
  // WhereInput na API e o `expand={}` deixa o tipo de retorno determinístico.
  const queryFrom = (o: AnyArgs): Record<string, string | undefined> => ({
    expand: JSON.stringify(o.expand ?? {}),
    where: JSON.stringify(o.where ?? {}),
    orderBy: o.orderBy !== undefined ? JSON.stringify(o.orderBy) : undefined,
    page: o.page !== undefined ? String(o.page) : undefined,
    perPage: o.perPage !== undefined ? String(o.perPage) : undefined,
  });

  const client: Record<string, unknown> = {};

  for (const [key, entity] of Object.entries(options.entities)) {
    const shape = entity.columns;
    const path = `/api/${entity.name}`;
    const revive = (o: unknown) => reviveShape(shape, o);
    const list = async (o: AnyArgs): Promise<ListResponse> =>
      (await request("GET", path, { query: queryFrom(o) })) as ListResponse;

    client[key] = {
      async create(input: unknown) {
        return revive(await request("POST", path, { body: input }));
      },
      async get(id: string, o: { expand?: unknown } = {}) {
        const r = await request("GET", `${path}/${encodeURIComponent(id)}`, {
          query: { expand: JSON.stringify(o.expand ?? {}) },
          allowNull: true,
        });
        return r === null ? null : revive(r);
      },
      async find(o: AnyArgs = {}) {
        return (await list(o)).docs?.map(revive) ?? [];
      },
      async findOne(o: AnyArgs = {}) {
        const d = (await list({ ...o, perPage: 1 })).docs?.[0];
        return d === undefined ? null : revive(d);
      },
      async paginate(o: AnyArgs = {}) {
        const page = await list(o);
        return {
          docs: page.docs?.map(revive) ?? [],
          docsQuantity: page.docsQuantity,
          pageQuantity: page.pageQuantity,
          currentPage: page.currentPage,
        };
      },
      async update(id: string, patch: unknown) {
        return revive(await request("PATCH", `${path}/${encodeURIComponent(id)}`, { body: patch }));
      },
      async delete(id: string) {
        await request("DELETE", `${path}/${encodeURIComponent(id)}`);
      },
    };
  }

  // `weave.as(scope, params)` → novo client com os headers de scope em toda req.
  client["as"] = (scope: string, params?: Record<string, unknown>) =>
    createClient({ ...options, scope, ...(params ? { params } : {}) });

  return client as unknown as WeaveClient<S>;
}
