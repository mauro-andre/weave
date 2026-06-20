/**
 * Entity declaration (Phase 1a, extended for owned in Phase 2a).
 *
 * `defineEntity` is the first-class table declaration. It captures the user's
 * shape and, conceptually, owns three managed system columns every entity (and
 * every owned sub-entity) gets: `id` (uuid PK), `createdAt`, `updatedAt`. The
 * system columns are materialized by the DDL layer and reflected in the
 * inference helpers below.
 */

import type { Column, InferColumn } from "./column.js";
import type { AnyOwned, OwnedShape, Owned } from "./owned.js";

/** A record of named fields — columns and/or owned relationships. */
export type ShapeRecord = Record<string, Column<unknown, boolean, boolean> | AnyOwned>;

/** The managed system columns every (sub-)entity carries. */
export interface SystemColumns {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Flatten an intersection into a single object literal for readable hovers. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** A declared entity: a table name plus its shape. */
export interface Entity<TName extends string, TShape extends ShapeRecord> {
  readonly name: TName;
  readonly columns: TShape;
}

/** Read type of a single field — a scalar column or a nested owned relationship. */
type InferField<V> =
  V extends Column<unknown, boolean, boolean>
    ? InferColumn<V>
    : V extends Owned<infer TShape, infer TCard>
      ? TCard extends "many"
        ? InferOwned<TShape>[]
        : InferOwned<TShape>
      : never;

/** Read type of a shape body (no system columns). */
type InferBody<TShape> = { [K in keyof TShape]: InferField<TShape[K]> };

/** Read type of an owned sub-entity: its own system columns + body. */
type InferOwned<TShape extends OwnedShape> = Prettify<
  Pick<SystemColumns, "id"> & InferBody<TShape> & Pick<SystemColumns, "createdAt" | "updatedAt">
>;

/** The plain object type an entity reads as: system columns + shape (owned nested). */
export type InferEntity<E> =
  E extends Entity<string, infer TShape>
    ? Prettify<
        Pick<SystemColumns, "id"> &
          InferBody<TShape> &
          Pick<SystemColumns, "createdAt" | "updatedAt">
      >
    : never;

// ── Insert type (Phase 2c) ───────────────────────────────────────────────────

/** Write value of one field. */
type InsertField<V> =
  V extends Column<infer TData, infer TNotNull, boolean>
    ? TNotNull extends true
      ? TData
      : TData | null
    : V extends Owned<infer TShape, infer TCard>
      ? TCard extends "many"
        ? InsertOwned<TShape>[]
        : InsertOwned<TShape>
      : never;

/** A field is required on insert only if it is `notNull` AND has no default. */
type IsRequired<V> = V extends Column<unknown, true, false> ? true : false;

/** Split a shape into required and optional insert keys. */
type InsertBody<TShape> = Prettify<
  { [K in keyof TShape as IsRequired<TShape[K]> extends true ? K : never]: InsertField<TShape[K]> } & {
    [K in keyof TShape as IsRequired<TShape[K]> extends true ? never : K]?: InsertField<TShape[K]>;
  }
>;

/** Insert type of an owned sub-entity: optional id, body, no timestamps. */
type InsertOwned<TShape extends OwnedShape> = Prettify<{ id?: string } & InsertBody<TShape>>;

/** The object accepted by `save`: optional id (upsert), body, no managed timestamps. */
export type InferInsert<E> =
  E extends Entity<string, infer TShape>
    ? Prettify<{ id?: string } & InsertBody<TShape>>
    : never;

/**
 * Declare an entity (a first-class table).
 *
 * ```ts
 * const user = defineEntity("users", {
 *   name: text().notNull(),
 *   addresses: owned(array({
 *     street: text().notNull(),
 *     landmarks: owned(array({ label: text().notNull() })),
 *   })),
 * });
 * ```
 */
export function defineEntity<TName extends string, TShape extends ShapeRecord>(
  name: TName,
  columns: TShape,
): Entity<TName, TShape> {
  return { name, columns };
}
