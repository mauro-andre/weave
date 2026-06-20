/**
 * Entity declaration (Phase 1a).
 *
 * `defineEntity` is the first-class table declaration. It captures the user's
 * column shape and, conceptually, owns three managed system columns that every
 * entity gets: `id` (uuid PK), `createdAt`, `updatedAt`. The system columns are
 * materialized by the DDL layer (Phase 1b) and reflected in {@link InferEntity}.
 */

import type { Column, InferColumn } from "./column.js";

/** A record of named user columns — the body passed to {@link defineEntity}. */
export type ShapeRecord = Record<string, Column<unknown, boolean>>;

/** The managed system columns every entity carries. */
export interface SystemColumns {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Flatten an intersection into a single object literal for readable hovers. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** A declared entity: a table name plus its user column shape. */
export interface Entity<TName extends string, TShape extends ShapeRecord> {
  readonly name: TName;
  readonly columns: TShape;
}

/** The plain object type an entity reads as: system columns + user shape. */
export type InferEntity<E> =
  E extends Entity<string, infer TShape>
    ? Prettify<
        Pick<SystemColumns, "id"> & {
          [K in keyof TShape]: InferColumn<TShape[K]>;
        } & Pick<SystemColumns, "createdAt" | "updatedAt">
      >
    : never;

/**
 * Declare an entity (a first-class table).
 *
 * ```ts
 * const user = defineEntity("users", {
 *   name:  text().notNull(),
 *   bio:   text(),
 *   phones: array(text()),
 * });
 * // InferEntity<typeof user> =
 * //   { id: string; name: string; bio: string | null;
 * //     phones: string[]; createdAt: Date; updatedAt: Date }
 * ```
 */
export function defineEntity<TName extends string, TShape extends ShapeRecord>(
  name: TName,
  columns: TShape,
): Entity<TName, TShape> {
  return { name, columns };
}
