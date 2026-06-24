/**
 * Named projection (Phase 6b).
 *
 * Binds a `select` map to an entity so a per-role view can be defined once and
 * reused — the typed base for handling field permissions in the application
 * (a non-selected field doesn't exist in the result type, so it can't leak).
 *
 * ```ts
 * const publicAuthor = projection(author, { name: true });
 * const hrAuthor     = projection(author, { name: true, salary: true });
 * await db.find(req.user.isHR ? hrAuthor : publicAuthor, { where: { … } });
 * ```
 */

import type { Entity, ShapeRecord, SelectInput } from "./entity.js";

export interface Projection<E, S> {
  readonly kind: "projection";
  readonly entity: E;
  readonly select: S;
}

/** A projection over any entity/select. */
export type AnyProjection = Projection<Entity<string, ShapeRecord>, unknown>;

/** Bind a `select` to an entity for reuse. */
export function projection<
  TName extends string,
  TShape extends ShapeRecord,
  S extends SelectInput<Entity<TName, TShape>>,
>(entity: Entity<TName, TShape>, select: S): Projection<Entity<TName, TShape>, S> {
  return { kind: "projection", entity, select };
}
