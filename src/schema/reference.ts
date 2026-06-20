/**
 * `reference` relationship — association (Phase 3).
 *
 * The target is an **independent** entity (its own table), possibly shared by
 * many. This side only **points and reads**: storage is a single FK column
 * (`<field>_id uuid`, no cascade); reads bring the target only on `expand`;
 * writes set the FK and never touch the target table.
 *
 * Declared once as `city: reference(cities)`, it surfaces as:
 *   - column   `city_id`   (the FK, auto-indexed, no cascade)
 *   - read key `cityId`     (always present)
 *   - read key `city`       (only when expanded)
 */

import type { Entity, ShapeRecord } from "./entity.js";

export class Reference<
  TTarget extends Entity<string, ShapeRecord> = Entity<string, ShapeRecord>,
  TNotNull extends boolean = false,
> {
  readonly kind = "reference" as const;
  /** Phantom carrier so the compiler can recover the target/nullability. */
  declare readonly _phantom: { target: TTarget; notNull: TNotNull };

  constructor(
    readonly target: TTarget,
    readonly isNotNull: boolean,
  ) {}

  /** Make the FK `NOT NULL` (the association is required). */
  notNull(): Reference<TTarget, true> {
    return new Reference<TTarget, true>(this.target, true);
  }
}

/** A reference of any target/nullability. */
export type AnyReference = Reference<Entity<string, ShapeRecord>, boolean>;

/** Declare a reference to an independent entity (nullable by default). */
export function reference<T extends Entity<string, ShapeRecord>>(
  target: T,
): Reference<T, false> {
  return new Reference<T, false>(target, false);
}
