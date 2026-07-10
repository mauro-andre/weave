/**
 * Entity declaration + inference.
 *
 * `defineEntity` captures the user's shape and, conceptually, owns three managed
 * system columns every (sub-)entity gets: `id` (uuid PK), `createdAt`,
 * `updatedAt`. Inference produces three views of a shape:
 *
 *   - {@link InferRead}   — the read object, parameterized by an `expand` map.
 *                           `owned` nests automatically; a `reference` surfaces
 *                           as `<field>Id` always, plus `<field>` when expanded.
 *   - {@link InferEntity} — `InferRead` with no expand (the default read shape).
 *   - {@link InferInsert} — the write object: notNull-without-default columns are
 *                           required, references are set via `<field>Id`.
 */

import type { Column, InferColumn } from "./column.js";
import type { AnyOwned, OwnedShape, Owned, OwnedCardinality } from "./owned.js";
import type { AnyReference } from "./reference.js";
import type { GroupExpr } from "./aggregate.js";

/** A record of named fields — columns, owned relationships, and/or references. */
export type ShapeRecord = Record<
  string,
  Column<unknown, boolean, boolean> | AnyOwned | AnyReference
>;

/** The managed system columns every (sub-)entity carries. */
export interface SystemColumns {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Flatten an intersection into a single object literal for readable hovers. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Constraints/índices no nível da ENTIDADE (multi-coluna). Cada grupo é uma lista
 * de nomes de campo: coluna → sua coluna; reference N:1 → a coluna FK `<campo>_id`.
 * (Owned e reference N:N não entram — não são colunas da tabela raiz.)
 */
export interface EntityOptions {
  /** Grupos de UNIQUE composto (alvo de `ON CONFLICT` / chave de rollup). */
  readonly unique?: string[][];
  /** Grupos de índice composto (não-único). */
  readonly index?: string[][];
  /**
   * Particiona a tabela por tempo (RANGE nativo). `timeBucket(field, interval)` — o
   * campo tem que ser um `timestamptz().notNull()`. Torna a tabela **append-only**
   * (a PK passa a ser `(id, <field>)`). Genérico: qualquer série-temporal de volume.
   */
  readonly partitionBy?: GroupExpr;
  /** Retenção da partição (ex.: `"30d"`): partições cujo topo já passou são **dropadas**. */
  readonly retention?: string;
}

/** A declared entity: a table name plus its shape (+ constraints de entidade). */
export interface Entity<TName extends string, TShape extends ShapeRecord> {
  readonly name: TName;
  readonly columns: TShape;
  readonly options?: EntityOptions;
}

// Valida os grupos de `unique`/`index` contra o shape (duck-typing pelos
// discriminadores — sem importar as classes em runtime). Cada membro precisa ser
// uma coluna OU uma reference N:1; owned / N:N / campo inexistente → erro.
function validateEntityOptions(columns: ShapeRecord, options: EntityOptions): void {
  const groups = [...(options.unique ?? []), ...(options.index ?? [])];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error("weave: a composite unique/index group must be a non-empty array of field names.");
    }
    const seen = new Set<string>();
    for (const field of group) {
      if (seen.has(field)) throw new Error(`weave: duplicate field '${field}' in a composite group.`);
      seen.add(field);
      const f = (columns as Record<string, unknown>)[field] as { kind?: string; cardinality?: string } | undefined;
      if (f === undefined) throw new Error(`weave: composite group references unknown field '${field}'.`);
      if (f.kind === "owned" || f.kind === "owned_array") {
        throw new Error(`weave: a composite group can't include the owned field '${field}'.`);
      }
      if (f.kind === "reference" && f.cardinality !== "one") {
        throw new Error(`weave: a composite group can't include the many-reference '${field}'.`);
      }
    }
  }

  // Partição por tempo: o campo tem que ser um `timestamptz().notNull()` (a chave de
  // RANGE não pode ser nula e precisa ser temporal). Duck-typing pelo `config` da Column.
  if (options.partitionBy) {
    const field = options.partitionBy.timeBucket?.field;
    if (!field) throw new Error("weave: partitionBy needs timeBucket(field, interval).");
    const f = (columns as Record<string, unknown>)[field] as
      | { config?: { pgType?: { name?: string }; notNull?: boolean } }
      | undefined;
    if (!f?.config) throw new Error(`weave: partitionBy field '${field}' must be a column.`);
    if (f.config.pgType?.name !== "timestamptz") {
      throw new Error(`weave: partitionBy field '${field}' must be a timestamptz column.`);
    }
    if (!f.config.notNull) throw new Error(`weave: partitionBy field '${field}' must be .notNull().`);
    if (!/^\d+(s|min|h|d)$/.test(options.partitionBy.timeBucket.interval)) {
      throw new Error(`weave: invalid partition interval '${options.partitionBy.timeBucket.interval}'.`);
    }
  }
  if (options.retention !== undefined && !/^\d+(s|min|h|d)$/.test(options.retention)) {
    throw new Error(`weave: invalid retention '${options.retention}' (use 7d, 30d, 12h, …).`);
  }
  if (options.retention !== undefined && !options.partitionBy) {
    throw new Error("weave: retention needs partitionBy (retention drops whole partitions).");
  }
}

// ── Field discriminators (by phantom / kind tag) ─────────────────────────────

type IsColumn<V> = V extends { _types: unknown } ? true : false;
type IsOwned<V> = V extends { kind: "owned" } ? true : false;
type IsReference<V> = V extends { kind: "reference" } ? true : false;
type IsRefOne<V> = IsReference<V> extends true ? (RefCard<V> extends "one" ? true : false) : false;
type IsRefMany<V> = IsReference<V> extends true ? (RefCard<V> extends "many" ? true : false) : false;

type RefTargetShape<V> =
  V extends { _phantom: { target: Entity<string, infer TS> } } ? TS : never;
type RefNotNull<V> = V extends { _phantom: { notNull: infer NN } } ? NN : false;
type RefCard<V> = V extends { _phantom: { cardinality: infer C } } ? C : "one";

/** Recursion-depth budget for cyclic schemas (caps nested expand types). */
type Budget = [unknown, unknown, unknown, unknown, unknown, unknown];
type Drop<D extends unknown[]> = D extends [unknown, ...infer R] ? R : [];

// ── Read inference (expand-parameterized) ────────────────────────────────────

/** The sub-expand map for key `K` (or `{}` when absent / `true`). */
type ExpandFor<X, K extends PropertyKey> = K extends keyof X
  ? X[K] extends true
    ? {}
    : X[K]
  : {};

type ReadBody<TShape, X> = {
  [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]: InferColumn<TShape[K]>;
} & {
  [K in keyof TShape as IsOwned<TShape[K]> extends true ? K : never]: TShape[K] extends Owned<
    infer S,
    infer C
  >
    ? C extends "many"
      ? Prettify<ReadShape<S, ExpandFor<X, K>>>[]
      : Prettify<ReadShape<S, ExpandFor<X, K>>>
    : never;
} & {
  // N:1 FK id — always present.
  [K in keyof TShape as IsRefOne<TShape[K]> extends true
    ? `${K & string}Id`
    : never]: RefNotNull<TShape[K]> extends true ? string : string | null;
} & {
  // N:1 expanded target — only for keys present in the expand map.
  [K in keyof TShape as IsRefOne<TShape[K]> extends true
    ? K extends keyof X
      ? K
      : never
    : never]: RefNotNull<TShape[K]> extends true
    ? Prettify<ReadShape<RefTargetShape<TShape[K]>, ExpandFor<X, K>>>
    : Prettify<ReadShape<RefTargetShape<TShape[K]>, ExpandFor<X, K>>> | null;
} & {
  // N:N expanded targets — array, only when expanded (nothing by default).
  [K in keyof TShape as IsRefMany<TShape[K]> extends true
    ? K extends keyof X
      ? K
      : never
    : never]: Prettify<ReadShape<RefTargetShape<TShape[K]>, ExpandFor<X, K>>>[];
};

// Raw intersection (no Prettify here, so the recursive alias stays lazy).
type ReadShape<TShape, X> = Pick<SystemColumns, "id"> &
  ReadBody<TShape, X> &
  Pick<SystemColumns, "createdAt" | "updatedAt">;

/** The read object for an entity, given an `expand` map `X`. */
export type InferRead<E, X> = E extends Entity<string, infer TShape>
  ? Prettify<ReadShape<TShape, X>>
  : never;

/** The default read object (no expand). */
export type InferEntity<E> = InferRead<E, {}>;

// ── Expand map ───────────────────────────────────────────────────────────────

type ExpandShape<TShape, D extends unknown[] = Budget> = D extends []
  ? {} // depth budget exhausted — stop recursing (cycle guard)
  : {
      [K in keyof TShape as IsReference<TShape[K]> extends true
        ? K
        : IsOwned<TShape[K]> extends true
          ? K
          : never]?: IsReference<TShape[K]> extends true
        ? true | ExpandShape<RefTargetShape<TShape[K]>, Drop<D>>
        : TShape[K] extends Owned<infer S, OwnedCardinality>
          ? ExpandShape<S, Drop<D>>
          : never;
    };

/** The shape of the `expand` option for an entity. */
export type ExpandInput<E> = E extends Entity<string, infer TShape>
  ? ExpandShape<TShape>
  : never;

// ── Insert inference ─────────────────────────────────────────────────────────

/** Tipo de ESCRITA de uma coluna: o data-type, mais `number` p/ colunas `bigint` (int8).
 *  Motivo: JSON não carrega `bigint`, então o valor de escrita trafega como `number`
 *  (o SDK coage `bigint→number` antes de serializar). Espelha o `.default()` do int8. */
type WriteData<TData> = TData extends bigint ? number | bigint : TData;

type InsertField<V> =
  IsColumn<V> extends true
    ? V extends Column<infer TData, infer NN, boolean>
      ? NN extends true
        ? WriteData<TData>
        : WriteData<TData> | null
      : never
    : IsOwned<V> extends true
      ? V extends Owned<infer S, infer C>
        ? C extends "many"
          ? InsertOwned<S>[]
          : InsertOwned<S>
        : never
      : never;

/** A column is required on insert only if it is `notNull` AND has no default. */
type RequiredColumn<V> = V extends { _types: { notNull: true; hasDefault: false } }
  ? true
  : false;

type InsertBody<TShape> = Prettify<
  {
    [K in keyof TShape as IsColumn<TShape[K]> extends true
      ? RequiredColumn<TShape[K]> extends true
        ? K
        : never
      : never]: InsertField<TShape[K]>;
  } & {
    [K in keyof TShape as IsColumn<TShape[K]> extends true
      ? RequiredColumn<TShape[K]> extends true
        ? never
        : K
      : never]?: InsertField<TShape[K]>;
  } & {
    [K in keyof TShape as IsOwned<TShape[K]> extends true ? K : never]?: InsertField<TShape[K]>;
  } & {
    // notNull N:1 reference → required `<field>Id`.
    [K in keyof TShape as IsRefOne<TShape[K]> extends true
      ? RefNotNull<TShape[K]> extends true
        ? `${K & string}Id`
        : never
      : never]: string;
  } & {
    // nullable N:1 reference → optional `<field>Id`, aceitando `null` (limpar a ref).
    [K in keyof TShape as IsRefOne<TShape[K]> extends true
      ? RefNotNull<TShape[K]> extends true
        ? never
        : `${K & string}Id`
      : never]?: string | null;
  } & {
    // N:N reference → optional `<field>Ids` (the link set; absent = empty).
    [K in keyof TShape as IsRefMany<TShape[K]> extends true
      ? `${K & string}Ids`
      : never]?: string[];
  }
>;

type InsertOwned<S extends OwnedShape> = Prettify<{ id?: string } & InsertBody<S>>;

/** The object accepted by `save`: optional id (upsert), body, no managed timestamps. */
export type InferInsert<E> = E extends Entity<string, infer TShape>
  ? Prettify<{ id?: string } & InsertBody<TShape>>
  : never;

// ── Projection (`select`, Phase 6) ───────────────────────────────────────────

type SelectShape<TShape, D extends unknown[] = Budget> = {
  id?: true;
  createdAt?: true;
  updatedAt?: true;
} & {
  [K in keyof TShape as IsColumn<TShape[K]> extends true ? K : never]?: true;
} & {
  [K in keyof TShape as IsRefOne<TShape[K]> extends true ? `${K & string}Id` : never]?: true;
} & (D extends []
  ? {}
  : {
      [K in keyof TShape as IsOwned<TShape[K]> extends true ? K : never]?:
        | true
        | (TShape[K] extends Owned<infer S, OwnedCardinality> ? SelectShape<S, Drop<D>> : never);
    } & {
      [K in keyof TShape as IsRefOne<TShape[K]> extends true
        ? K
        : IsRefMany<TShape[K]> extends true
          ? K
          : never]?: true | SelectShape<RefTargetShape<TShape[K]>, Drop<D>>;
    });

/** The shape of the `select` option for an entity. */
export type SelectInput<E> = E extends Entity<string, infer TShape> ? SelectShape<TShape> : never;

/** Full read of a sub-shape (all fields, references as ids) — used by `true`. */
type FullRead<TShape> = Prettify<ReadShape<TShape, {}>>;

type SelectSub<SubShape, Sel> = Sel extends true ? FullRead<SubShape> : SelectResultShape<SubShape, Sel>;

type SelectFieldType<TShape, K, Sel> = K extends "id"
  ? string
  : K extends "createdAt" | "updatedAt"
    ? Date
    : K extends keyof TShape
      ? IsColumn<TShape[K]> extends true
        ? InferColumn<TShape[K]>
        : TShape[K] extends Owned<infer S, infer C>
          ? C extends "many"
            ? SelectSub<S, Sel>[]
            : SelectSub<S, Sel>
          : IsRefOne<TShape[K]> extends true
            ? RefNotNull<TShape[K]> extends true
              ? SelectSub<RefTargetShape<TShape[K]>, Sel>
              : SelectSub<RefTargetShape<TShape[K]>, Sel> | null
            : IsRefMany<TShape[K]> extends true
              ? SelectSub<RefTargetShape<TShape[K]>, Sel>[]
              : never
      : K extends `${infer F}Id`
        ? F extends keyof TShape
          ? IsRefOne<TShape[F]> extends true
            ? RefNotNull<TShape[F]> extends true
              ? string
              : string | null
            : never
          : never
        : never;

// `-readonly` normaliza o resultado: um `select` vindo com `const` (ex.: o `const S` do
// client SDK) chega como `{ readonly … }`, e sem o strip o `readonly` vazaria pro tipo lido.
type SelectResultShape<TShape, S> = Prettify<
  { id: string } & { -readonly [K in keyof S]: SelectFieldType<TShape, K, S[K]> }
>;

/** The pruned read object for an entity, given a `select` map `S`. */
export type InferSelect<E, S> = E extends Entity<string, infer TShape>
  ? SelectResultShape<TShape, S>
  : never;

/** Declare an entity (a first-class table). */
export function defineEntity<TName extends string, TShape extends ShapeRecord>(
  name: TName,
  columns: TShape,
  options?: EntityOptions,
): Entity<TName, TShape> {
  if (options) validateEntityOptions(columns, options);
  return options ? { name, columns, options } : { name, columns };
}
