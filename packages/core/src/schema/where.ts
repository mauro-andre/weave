import type { Entity } from "./entity.js";
import type { Owned, OwnedShape, OwnedCardinality } from "./owned.js";

// Tipos de FILTRO e ORDENAÇÃO tipados (Prisma-style), parametrizados pela forma da
// entidade. Vivem no `core` porque são a LINGUAGEM DE QUERY compartilhada: o engine
// (compileFind), a GUI (FilterBar/SortBar), a API e o SDK falam todos `WhereInput`.
// Aqui é só a forma de TIPO; a compilação pra SQL é runtime (engine/query/read.ts).

// ── Discriminadores de campo (por phantom / tag de kind) ──────────────────────
type IsColumn<V> = V extends { _types: unknown } ? true : false;
type IsOwned<V> = V extends { kind: "owned" } ? true : false;
type IsRefOne<V> = V extends { _phantom: { cardinality: "one" } } ? true : false;
type IsRefMany<V> = V extends { _phantom: { cardinality: "many" } } ? true : false;
type ColumnData<V> = V extends { _types: { data: infer D } } ? D : never;
type RefTargetShape<V> = V extends { _phantom: { target: Entity<string, infer TS> } } ? TS : never;

/** Orçamento de profundidade pra filtros aninhados (guarda contra ciclos). */
type WBudget = [unknown, unknown, unknown, unknown, unknown, unknown];
type WDrop<D extends unknown[]> = D extends [unknown, ...infer R] ? R : [];

// Todo slot de VALOR escalar é augmentado por `P` (default `never` = sem augmentação,
// então `WhereInput` fica idêntico). O scope usa `P = { param: string }` pra permitir
// `{ param: "x" }` em qualquer folha (`ScopeWhereInput`) — literal e param se misturam.

/** Operadores só-de-string, somados quando o tipo do dado é `string`. */
type StringOps<P = never> = { like?: string | P; ilike?: string | P };

/** Operadores de comparação/pertinência pra uma coluna escalar de tipo `T`. */
type ScalarOps<T, P = never> = {
  eq?: T | null | P; // null → IS NULL
  ne?: T | null | P; // null → IS NOT NULL
  gt?: T | P;
  gte?: T | P;
  lt?: T | P;
  lte?: T | P;
  in?: T[] | P;
  notIn?: T[] | P;
  isNull?: boolean;
} & ([T] extends [string] ? StringOps<P> : {});

/** Filtro de uma coluna escalar: um valor cru (atalho de `eq`) ou um objeto de operadores. */
export type Filter<T, P = never> = T | P | ScalarOps<T, P>;

/** Operadores pra uma coluna de array escalar (`text[]`, `int4[]`, …). */
export type ArrayFilter<E, P = never> = {
  has?: E | P;
  hasSome?: E[] | P;
  hasEvery?: E[] | P;
  isEmpty?: boolean;
  /** Algum elemento casa estes operadores escalares (o "any …" da GUI). */
  some?: ScalarOps<E, P>;
};

/** Filtro de uma coluna — operadores de array pra `type[]`, escalares senão. */
type ColumnFilter<V, P = never> = ColumnData<V> extends (infer E)[] ? ArrayFilter<E, P> : Filter<ColumnData<V>, P>;

/** Quantificadores sobre um relacionamento to-many (owned 1:N / reference N:N). */
type Quantifier<W> = { some?: W; every?: W; none?: W };

type WhereShape<TShape, D extends unknown[] = WBudget, P = never> = {
  id?: Filter<string, P>;
  createdAt?: Filter<Date, P>;
  updatedAt?: Filter<Date, P>;
  and?: WhereShape<TShape, D, P>[];
  or?: WhereShape<TShape, D, P>[];
  not?: WhereShape<TShape, D, P>;
} & (D extends []
  ? {}
  : {
      // colunas escalares / array
      [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]?: ColumnFilter<TShape[K], P>;
    } & {
      // owned 1:1 → filtro aninhado; owned 1:N → quantificador
      [K in keyof TShape as IsOwned<TShape[K]> extends true ? K : never]?: TShape[K] extends Owned<
        infer S,
        infer C
      >
        ? C extends "many"
          ? Quantifier<WhereShape<S, WDrop<D>, P>>
          : WhereShape<S, WDrop<D>, P>
        : never;
    } & {
      // reference N:1 → filtro aninhado no alvo
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? K : never]?: WhereShape<
        RefTargetShape<TShape[K]>,
        WDrop<D>,
        P
      >;
    } & {
      // reference N:1 → também filtra pela FK direta
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? `${K & string}Id` : never]?: Filter<string, P>;
    } & {
      // reference N:N → quantificador sobre os alvos ligados
      [K in keyof TShape as IsRefMany<TShape[K]> extends true ? K : never]?: Quantifier<
        WhereShape<RefTargetShape<TShape[K]>, WDrop<D>, P>
      >;
    });

/**
 * Filtro sobre uma entidade. Operadores escalares (`gt`/`in`/`ilike`/…), de array
 * (`has`/`hasSome`/…), lógicos `and`/`or`/`not`, e filtro **aninhado** sobre
 * `owned`/`reference` com quantificadores `some`/`every`/`none`.
 */
export type WhereInput<E> = E extends Entity<string, infer TShape> ? WhereShape<TShape> : never;

/**
 * Igual ao `WhereInput`, mas cada folha escalar também aceita `{ param: "x" }` — o
 * filtro de linhas de um SCOPE, resolvido no request-time. Literal e param se misturam
 * livremente (`{ and: [{ company: { eq: { param: "co" } } }, { active: { eq: true } }] }`).
 * (Obs.: `not` não é suportado no storage do scope — usar `not` falha no push.)
 */
export type ScopeWhereInput<E> = E extends Entity<string, infer TShape>
  ? WhereShape<TShape, WBudget, { param: string }>
  : never;

/** Orçamento de profundidade pro dot-path (guarda contra ciclos). */
type PBudget = [unknown, unknown, unknown, unknown, unknown];

// Dot-paths válidos numa entity: cada coluna é uma folha (`K`); owned/reference conta a
// própria chave (a subárvore inteira) OU `${K}.${path do alvo}`. Guardado por profundidade.
type PathOf<TShape, D extends unknown[] = PBudget> = D extends []
  ? never
  : {
      [K in keyof TShape & string]: IsColumn<TShape[K]> extends true
        ? K
        : IsOwned<TShape[K]> extends true
          ? TShape[K] extends Owned<infer S, OwnedCardinality>
            ? K | `${K}.${PathOf<S, WDrop<D>> & string}`
            : K
          : IsRefOne<TShape[K]> extends true
            ? K | `${K}.${PathOf<RefTargetShape<TShape[K]>, WDrop<D>> & string}`
            : IsRefMany<TShape[K]> extends true
              ? K | `${K}.${PathOf<RefTargetShape<TShape[K]>, WDrop<D>> & string}`
              : never;
    }[keyof TShape & string];

/**
 * Dot-path de campo de uma entity, pra a PROJEÇÃO de um scope (`fields.include/exclude`).
 * Folha (`"whatsapp"`), path aninhado (`"summaryForTheManager.expectedRoi"`) ou uma
 * subárvore inteira (`"customer"`). Typo/rename viram erro de compilação.
 */
export type FieldPath<E> = E extends Entity<string, infer TShape> ? PathOf<TShape> : never;

/**
 * Union dos NOMES de param (`{ param: "x" }`) em qualquer lugar de uma árvore — o where
 * de um scope. Anda por objetos e arrays; a folha `{ param: L }` rende o literal `L`.
 * Requer que os literais sejam preservados (o `scopeRule` usa `const` no config).
 */
export type ExtractParams<T> = T extends { param: infer L }
  ? L extends string
    ? L
    : never
  : T extends readonly (infer U)[]
    ? ExtractParams<U>
    : T extends object
      ? { [K in keyof T]: ExtractParams<T[K]> }[keyof T]
      : never;

/** Direção de ordenação. */
export type SortDir = "asc" | "desc";

type OrderByShape<TShape, D extends unknown[] = WBudget> = {
  id?: SortDir;
  createdAt?: SortDir;
  updatedAt?: SortDir;
} & (D extends []
  ? {}
  : {
      // colunas escalares da raiz
      [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]?: SortDir;
    } & {
      // owned 1:1 → orderby ANINHADO (1:N/N:N não fazem sentido pra ordenar)
      [K in keyof TShape as TShape[K] extends Owned<OwnedShape, "one"> ? K : never]?: TShape[K] extends Owned<
        infer S,
        "one"
      >
        ? OrderByShape<S, WDrop<D>>
        : never;
    } & {
      // reference N:1 → orderby aninhado no alvo
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? K : never]?: OrderByShape<
        RefTargetShape<TShape[K]>,
        WDrop<D>
      >;
    });

/** Ordena pelo `id`, timestamps, colunas escalares, ou um caminho aninhado (owned 1:1 / reference N:1). */
export type OrderByInput<E> = E extends Entity<string, infer TShape> ? OrderByShape<TShape> : never;
