import type {
  Entity,
  ShapeRecord,
  InferEntity,
  InferInsert,
  InferRead,
  ExpandInput,
  WhereInput,
  OrderByInput,
  AggregateInput,
  AggregateOutput,
  AccumulateOp,
} from "../../core/src/index.js";
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
 * Modificadores de leitura, **tipados pela entidade**: `orderBy` (`OrderByInput`) e
 * `expand` (`ExpandInput`), que ainda **dirige o tipo do retorno** (`InferRead<E, X>`).
 * O `where` NÃO vem aqui — é o 1º argumento cru do método.
 */
export interface ReadOpts<E extends Entity<string, ShapeRecord>, X> {
  orderBy?: OrderByInput<E>;
  expand?: X & ExpandInput<E>;
  /**
   * Greatest-n-per-group: uma linha por combinação destes campos (`DISTINCT ON`).
   * O `orderBy` decide qual sobrevive (ex.: `{ ts: "desc" }` → a mais recente).
   * É o widget de métricas vivas ("o doc mais recente por worker/container").
   */
  latestPer?: (keyof E["columns"] & string)[];
}

export interface PageOpts<E extends Entity<string, ShapeRecord>, X> extends ReadOpts<E, X> {
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
 * Client tipado de UMA entidade. Uma linha se mira por **`where` cru** (1º arg) —
 * `{ id: "123" }` é açúcar pra `{ id: { eq: "123" } }`. Verbos com `One` pegam o
 * **primeiro match** (`orderBy` desempata); com `Many` operam em massa e devolvem
 * `{ count }`. Os reads se **auto-tipam pelo `expand`** (`const X` → `InferRead`).
 */
export interface EntityClient<E extends Entity<string, ShapeRecord>> {
  create(input: InferInsert<E>): Promise<InferEntity<E>>;
  /** Cria em lote (ingest — uma transação). Devolve as linhas na ordem de entrada. */
  createMany(inputs: InferInsert<E>[]): Promise<InferEntity<E>[]>;

  findOne<const X = {}>(where?: WhereInput<E>, opts?: ReadOpts<E, X>): Promise<InferRead<E, X> | null>;
  findMany<const X = {}>(where?: WhereInput<E>, opts?: ReadOpts<E, X>): Promise<InferRead<E, X>[]>;
  paginate<const X = {}>(where?: WhereInput<E>, opts?: PageOpts<E, X>): Promise<PageResult<InferRead<E, X>>>;

  updateOne(
    where: WhereInput<E>,
    patch: Partial<InferInsert<E>>,
    opts?: { orderBy?: OrderByInput<E> },
  ): Promise<InferEntity<E> | null>;
  updateMany(where: WhereInput<E>, patch: Partial<InferInsert<E>>): Promise<{ count: number }>;

  deleteOne(where: WhereInput<E>, opts?: { orderBy?: OrderByInput<E> }): Promise<InferEntity<E> | null>;
  deleteMany(where: WhereInput<E>): Promise<{ count: number }>;

  /**
   * Agrega (groupBy + acumuladores + having + orderBy). Sem `facets` no input,
   * devolve `AggregateRow[]`; COM `facets`, devolve `{ rows, facets }` — o tipo de
   * retorno se auto-ajusta ao input (igual o `expand`).
   */
  aggregate<const I extends AggregateInput<E>>(input: I): Promise<AggregateOutput<I>>;

  /**
   * Acumula no tier histórico: um upsert mergeável na `key` (o unique declarado da
   * entidade), aplicando `ops` (`inc`/`max`/`min`/`setOnInsert`) atomicamente no
   * Postgres. Devolve a linha resultante (inc-and-return). A média se deriva na
   * LEITURA (`sum/count`) — nunca se guarda média pronta.
   */
  accumulate(key: Partial<InferInsert<E>>, ops: Record<string, AccumulateOp>): Promise<InferEntity<E>>;
}

/** O client completo: uma propriedade por entidade do entities + `as` (scope). */
export type WeaveClient<S extends Record<string, Entity<string, ShapeRecord>>> = {
  [K in keyof S]: EntityClient<S[K]>;
} & {
  /** Client escopado: toda requisição leva `x-weave-scope` + `x-weave-params`. */
  as(scope: string, params?: Record<string, unknown>): WeaveClient<S>;
  /**
   * Factory reset — **dev/test only**. Zera o banco pra estado virgem (apaga dados,
   * tabelas de entity e o schema todo); um `push` em seguida reconstrói. Só funciona
   * se o servidor tiver `WEAVE_DEV_MODE` setada — senão responde 403 e não faz nada.
   */
  reset(): Promise<void>;
};

interface ListResponse {
  docs?: Record<string, unknown>[];
  docsQuantity: number;
  pageQuantity: number;
  currentPage: number;
}

// Formas frouxas usadas SÓ na implementação (a interface dá os tipos).
type AnyOpts = { orderBy?: unknown; expand?: unknown; page?: number; perPage?: number; latestPer?: unknown };

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
      // `bigint` (valores de int8) não serializa em JSON — coage p/ number no fio (o
      // idioma de escrita do int8 aceita number|bigint; ver `WriteData`/`.default()`).
      init.body = JSON.stringify(opts.body, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
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
  const readQuery = (where: unknown, o: AnyOpts): Record<string, string | undefined> => ({
    where: JSON.stringify(where ?? {}),
    expand: JSON.stringify(o.expand ?? {}),
    orderBy: o.orderBy !== undefined ? JSON.stringify(o.orderBy) : undefined,
    latestPer: o.latestPer !== undefined ? JSON.stringify(o.latestPer) : undefined,
    page: o.page !== undefined ? String(o.page) : undefined,
    perPage: o.perPage !== undefined ? String(o.perPage) : undefined,
  });
  // Mutação por where: `where` (+ `orderBy` pro *One desempatar) + `mode` (`many` no bulk).
  const mutQuery = (where: unknown, o: AnyOpts, mode?: "many"): Record<string, string | undefined> => ({
    where: JSON.stringify(where ?? {}),
    orderBy: o.orderBy !== undefined ? JSON.stringify(o.orderBy) : undefined,
    mode,
  });

  const client: Record<string, unknown> = {};

  for (const [key, entity] of Object.entries(options.entities)) {
    const shape = entity.columns;
    const path = `/api/${entity.name}`;
    const revive = (o: unknown) => reviveShape(shape, o);
    const list = async (where: unknown, o: AnyOpts): Promise<ListResponse> =>
      (await request("GET", path, { query: readQuery(where, o) })) as ListResponse;

    client[key] = {
      async create(input: unknown) {
        return revive(await request("POST", path, { body: input }));
      },
      async createMany(inputs: unknown[]) {
        if (!Array.isArray(inputs) || inputs.length === 0) return [];
        const rows = (await request("POST", path, { body: inputs })) as unknown[];
        return rows.map(revive);
      },
      async findOne(where: unknown = {}, o: AnyOpts = {}) {
        const d = (await list(where, { ...o, perPage: 1 })).docs?.[0];
        return d === undefined ? null : revive(d);
      },
      async findMany(where: unknown = {}, o: AnyOpts = {}) {
        return (await list(where, o)).docs?.map(revive) ?? [];
      },
      async paginate(where: unknown = {}, o: AnyOpts = {}) {
        const page = await list(where, o);
        return {
          docs: page.docs?.map(revive) ?? [],
          docsQuantity: page.docsQuantity,
          pageQuantity: page.pageQuantity,
          currentPage: page.currentPage,
        };
      },
      async updateOne(where: unknown, patch: unknown, o: AnyOpts = {}) {
        const r = await request("PATCH", path, { query: mutQuery(where, o), body: patch, allowNull: true });
        return r === null ? null : revive(r);
      },
      async updateMany(where: unknown, patch: unknown) {
        const r = (await request("PATCH", path, { query: mutQuery(where, {}, "many"), body: patch })) as {
          count: number;
        };
        return { count: r.count };
      },
      async deleteOne(where: unknown, o: AnyOpts = {}) {
        const r = await request("DELETE", path, { query: mutQuery(where, o), allowNull: true });
        return r === null ? null : revive(r);
      },
      async deleteMany(where: unknown) {
        const r = (await request("DELETE", path, { query: mutQuery(where, {}, "many") })) as { count: number };
        return { count: r.count };
      },
      async accumulate(key: unknown, ops: unknown) {
        return revive(await request("POST", `${path}/accumulate`, { body: { key, ops } }));
      },
      async aggregate(input: unknown) {
        const r = (await request("POST", `${path}/aggregate`, { body: input })) as {
          rows?: unknown[];
          facets?: Record<string, unknown[]>;
        };
        const rows = (r.rows ?? []) as Record<string, unknown>[];
        // auto-tipado: input com facets → { rows, facets }; sem → rows[] pelado.
        return (
          input && (input as { facets?: unknown }).facets ? { rows, facets: r.facets ?? {} } : rows
        ) as never;
      },
    };
  }

  // `weave.as(scope, params)` → novo client com os headers de scope em toda req.
  client["as"] = (scope: string, params?: Record<string, unknown>) =>
    createClient({ ...options, scope, ...(params ? { params } : {}) });

  // `weave.reset()` → factory reset (dev/test only; gated por WEAVE_DEV_MODE no server).
  client["reset"] = async () => {
    await request("POST", "/admin/reset");
  };

  return client as unknown as WeaveClient<S>;
}
