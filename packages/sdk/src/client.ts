import type { Entity, ShapeRecord, InferEntity, InferInsert } from "@mauroandre/weave-core";
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
  /** O schema-as-code: `{ nome: defineEntity(...) }`. */
  schema: S;
  /** Transporte. Default: `globalThis.fetch`. Nos testes: `app.hono.fetch`. */
  fetch?: FetchLike;
}

/** Opções de leitura. `filter`/`sort` são pass-through pro JSON da API (typed where = F2). */
export interface FindOptions {
  filter?: unknown;
  sort?: unknown;
  page?: number;
  perPage?: number;
}

export interface PageResult<T> {
  docs: T[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

/** Client tipado de UMA entidade. Reads se auto-tipam; writes recebem `InferInsert`. */
export interface EntityClient<E extends Entity<string, ShapeRecord>> {
  create(input: InferInsert<E>): Promise<InferEntity<E>>;
  get(id: string): Promise<InferEntity<E> | null>;
  find(opts?: FindOptions): Promise<InferEntity<E>[]>;
  findOne(opts?: FindOptions): Promise<InferEntity<E> | null>;
  paginate(opts?: FindOptions): Promise<PageResult<InferEntity<E>>>;
  update(id: string, patch: Partial<InferInsert<E>>): Promise<InferEntity<E>>;
  delete(id: string): Promise<void>;
}

/** O client completo: uma propriedade por entidade do schema. */
export type WeaveClient<S extends Record<string, Entity<string, ShapeRecord>>> = {
  [K in keyof S]: EntityClient<S[K]>;
};

interface ListResponse {
  docs?: Record<string, unknown>[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

/**
 * Cria o client tipado a partir do schema-as-code. Casca fina sobre a API HTTP do
 * Weave: monta o request, manda o `x-api-key`, e revive `obj↔json` (datas) pela
 * forma da entidade. O `fetch` é injetável — em teste, `app.hono.fetch`.
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

  const queryFrom = (o: FindOptions): Record<string, string | undefined> => ({
    filter: o.filter !== undefined ? JSON.stringify(o.filter) : undefined,
    sort: o.sort !== undefined ? JSON.stringify(o.sort) : undefined,
    page: o.page !== undefined ? String(o.page) : undefined,
    perPage: o.perPage !== undefined ? String(o.perPage) : undefined,
  });

  const client: Record<string, EntityClient<Entity<string, ShapeRecord>>> = {};

  for (const [key, entity] of Object.entries(options.schema)) {
    const shape = entity.columns;
    const path = `/api/${entity.name}`;
    const revive = (o: unknown) => reviveShape(shape, o) as never;

    client[key] = {
      async create(input) {
        return revive(await request("POST", path, { body: input }));
      },
      async get(id) {
        const r = await request("GET", `${path}/${encodeURIComponent(id)}`, { allowNull: true });
        return r === null ? null : revive(r);
      },
      async find(opts = {}) {
        const page = (await request("GET", path, { query: queryFrom(opts) })) as ListResponse;
        return (page.docs ?? []).map(revive);
      },
      async findOne(opts = {}) {
        const page = (await request("GET", path, { query: queryFrom({ ...opts, perPage: 1 }) })) as ListResponse;
        const d = page.docs?.[0];
        return d === undefined ? null : revive(d);
      },
      async paginate(opts = {}) {
        const page = (await request("GET", path, { query: queryFrom(opts) })) as ListResponse;
        return {
          docs: (page.docs ?? []).map(revive),
          docsQuantity: page.docsQuantity,
          pageQuantity: page.pageQuantity,
          currentPage: page.currentPage,
        };
      },
      async update(id, patch) {
        return revive(await request("PATCH", `${path}/${encodeURIComponent(id)}`, { body: patch }));
      },
      async delete(id) {
        await request("DELETE", `${path}/${encodeURIComponent(id)}`);
      },
    };
  }

  return client as unknown as WeaveClient<S>;
}
