/**
 * `reference` relationship — association (Phases 3 & 4).
 *
 * The target is an **independent** entity (its own table), possibly shared by
 * many. This side only **points and reads**: it never writes the target table.
 *
 *   - `reference(city)`         → N:1. FK column `city_id` (no cascade).
 *                                 Reads `cityId` always, `city` on expand.
 *   - `reference(array(city))`  → N:N. A join table (`user_cities`), composite
 *                                 PK, both FKs cascade the *link*. Reads nothing
 *                                 by default; `cities: City[]` on expand. Writes
 *                                 via `citiesIds: string[]` (replaces the set).
 */

import type { Entity, ShapeRecord } from "./entity.js";

export type ReferenceCardinality = "one" | "many";

export class Reference<
  TTarget extends Entity<string, ShapeRecord> = Entity<string, ShapeRecord>,
  TCard extends ReferenceCardinality = "one",
  TNotNull extends boolean = false,
> {
  readonly kind = "reference" as const;
  /** Phantom carrier so the compiler can recover target/cardinality/nullability. */
  declare readonly _phantom: { target: TTarget; cardinality: TCard; notNull: TNotNull };

  constructor(
    readonly target: TTarget,
    readonly cardinality: TCard,
    readonly isNotNull: boolean,
    /** Stable field id (UUID) — survives rename. Normally emitted by `weave gen`. */
    readonly id?: string,
  ) {}

  /** Make the FK `NOT NULL` (only meaningful for N:1). */
  notNull(): Reference<TTarget, TCard, true> {
    return new Reference<TTarget, TCard, true>(this.target, this.cardinality, true, this.id);
  }

  /** Pin a stable field id (survives rename). Normally emitted by `weave gen`. */
  $id(id: string): Reference<TTarget, TCard, TNotNull> {
    return new Reference<TTarget, TCard, TNotNull>(this.target, this.cardinality, this.isNotNull, id);
  }
}

/** A reference of any target/cardinality/nullability. */
export type AnyReference = Reference<Entity<string, ShapeRecord>, ReferenceCardinality, boolean>;

/** Marker produced by `array(entity)` to signal an N:N reference. */
export class ReferenceArray<TTarget extends Entity<string, ShapeRecord>> {
  readonly kind = "reference_array" as const;
  constructor(readonly target: TTarget) {}
}

/** Declare an N:1 reference to an independent entity (nullable by default). */
export function reference<T extends Entity<string, ShapeRecord>>(
  target: T,
): Reference<T, "one", false>;
/** Declare an N:N reference (from `array(entity)`). */
export function reference<T extends Entity<string, ShapeRecord>>(
  set: ReferenceArray<T>,
): Reference<T, "many", false>;
export function reference(
  arg: Entity<string, ShapeRecord> | ReferenceArray<Entity<string, ShapeRecord>>,
): Reference<Entity<string, ShapeRecord>, ReferenceCardinality, false> {
  if (arg instanceof ReferenceArray) {
    return new Reference(arg.target, "many", false);
  }
  return new Reference(arg, "one", false);
}
