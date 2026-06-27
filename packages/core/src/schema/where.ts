import type { Entity } from "./entity.js";
import type { Owned, OwnedShape } from "./owned.js";

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

/** Operadores só-de-string, somados quando o tipo do dado é `string`. */
type StringOps = { like?: string; ilike?: string };

/** Operadores de comparação/pertinência pra uma coluna escalar de tipo `T`. */
type ScalarOps<T> = {
  eq?: T | null; // null → IS NULL
  ne?: T | null; // null → IS NOT NULL
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  in?: T[];
  notIn?: T[];
  isNull?: boolean;
} & ([T] extends [string] ? StringOps : {});

/** Filtro de uma coluna escalar: um valor cru (atalho de `eq`) ou um objeto de operadores. */
export type Filter<T> = T | ScalarOps<T>;

/** Operadores pra uma coluna de array escalar (`text[]`, …). */
export type ArrayFilter<E> = {
  has?: E;
  hasSome?: E[];
  hasEvery?: E[];
  isEmpty?: boolean;
};

/** Filtro de uma coluna — operadores de array pra `type[]`, escalares senão. */
type ColumnFilter<V> = ColumnData<V> extends (infer E)[] ? ArrayFilter<E> : Filter<ColumnData<V>>;

/** Quantificadores sobre um relacionamento to-many (owned 1:N / reference N:N). */
type Quantifier<W> = { some?: W; every?: W; none?: W };

type WhereShape<TShape, D extends unknown[] = WBudget> = {
  id?: Filter<string>;
  createdAt?: Filter<Date>;
  updatedAt?: Filter<Date>;
  and?: WhereShape<TShape, D>[];
  or?: WhereShape<TShape, D>[];
  not?: WhereShape<TShape, D>;
} & (D extends []
  ? {}
  : {
      // colunas escalares / array
      [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]?: ColumnFilter<TShape[K]>;
    } & {
      // owned 1:1 → filtro aninhado; owned 1:N → quantificador
      [K in keyof TShape as IsOwned<TShape[K]> extends true ? K : never]?: TShape[K] extends Owned<
        infer S,
        infer C
      >
        ? C extends "many"
          ? Quantifier<WhereShape<S, WDrop<D>>>
          : WhereShape<S, WDrop<D>>
        : never;
    } & {
      // reference N:1 → filtro aninhado no alvo
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? K : never]?: WhereShape<
        RefTargetShape<TShape[K]>,
        WDrop<D>
      >;
    } & {
      // reference N:1 → também filtra pela FK direta
      [K in keyof TShape as IsRefOne<TShape[K]> extends true ? `${K & string}Id` : never]?: Filter<string>;
    } & {
      // reference N:N → quantificador sobre os alvos ligados
      [K in keyof TShape as IsRefMany<TShape[K]> extends true ? K : never]?: Quantifier<
        WhereShape<RefTargetShape<TShape[K]>, WDrop<D>>
      >;
    });

/**
 * Filtro sobre uma entidade. Operadores escalares (`gt`/`in`/`ilike`/…), de array
 * (`has`/`hasSome`/…), lógicos `and`/`or`/`not`, e filtro **aninhado** sobre
 * `owned`/`reference` com quantificadores `some`/`every`/`none`.
 */
export type WhereInput<E> = E extends Entity<string, infer TShape> ? WhereShape<TShape> : never;

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
