/**
 * `owned` relationship — composition (Phase 2).
 *
 * An owned sub-shape is stored in a **dedicated child table**, prefixed by the
 * ownership path, with an FK to the immediate parent and `ON DELETE CASCADE`.
 * It can nest recursively (owned within owned). Cardinality:
 *
 *   - `owned({...})`          → 1:1, one child row.
 *   - `owned(array({...}))`   → 1:N, many child rows.
 *
 * Owned sub-entities get their own `id`/`createdAt`/`updatedAt`, like any table.
 */

import { Column } from "./column.js";
import type { AnyReference } from "./reference.js";
import type { Entity, ShapeRecord } from "./entity.js";

export type OwnedCardinality = "one" | "many";

/** A sub-shape: columns, further owned relationships, and/or references. */
export type OwnedShape = Record<
  string,
  Column<unknown, boolean, boolean> | AnyOwned | AnyReference
>;

/** Options for an owned relationship. */
export interface OwnedOptions {
  /** Override the generated child-table name (escape valve for deep nesting). */
  table?: string;
}

/** An owned relationship node in a shape. */
export class Owned<TShape extends OwnedShape, TCard extends OwnedCardinality> {
  readonly kind = "owned" as const;
  constructor(
    readonly shape: TShape,
    readonly cardinality: TCard,
    readonly options: OwnedOptions,
    /** Stable field id (UUID) — survives rename. Normally emitted by `weave gen`. */
    readonly id?: string,
    /** Mirror target entity name — the base whose shape is copied in (snapshot). */
    readonly mirrorName?: string,
  ) {}

  /** Pin a stable field id (survives rename). Normally emitted by `weave gen`. */
  $id(id: string): Owned<TShape, TCard> {
    return new Owned(this.shape, this.cardinality, this.options, id, this.mirrorName);
  }
}

/** An owned relationship of any shape/cardinality. */
export type AnyOwned = Owned<OwnedShape, OwnedCardinality>;

/** Marker produced by `array({...})` to signal a 1:N owned set. */
export class OwnedArray<TShape extends OwnedShape> {
  readonly kind = "owned_array" as const;
  constructor(
    readonly shape: TShape,
    /** Mirror target name when built from `array(mirror(...))`. */
    readonly mirrorName?: string,
  ) {}
}

/**
 * Snapshot of another entity's shape into an owned child — a **mirror**. The base's
 * fields are copied in (materialized server-side), plus any local extras. Takes the
 * ENTITY (like `reference`), not its name. `TShape` is the type-level merged shape
 * (base ⋂ extras); at runtime it carries only the extras + the base's name.
 */
export class Mirror<TShape extends OwnedShape> {
  readonly kind = "mirror" as const;
  constructor(
    readonly mirrorName: string,
    /** Local extra fields (the base is resolved server-side). */
    readonly extra: OwnedShape,
  ) {}
}

/** Mirror an entity's shape into an owned child, optionally adding local fields. */
export function mirror<TBase extends ShapeRecord, TExtra extends OwnedShape = {}>(
  entity: Entity<string, TBase>,
  extra: TExtra = {} as TExtra,
): Mirror<TBase & TExtra> {
  return new Mirror<TBase & TExtra>(entity.name, extra);
}

/** Declare an owned 1:1 relationship. */
export function owned<TShape extends OwnedShape>(shape: TShape, options?: OwnedOptions): Owned<TShape, "one">;
/** Declare an owned 1:1 mirror (`owned(mirror(base, { extras }))`). */
export function owned<TShape extends OwnedShape>(m: Mirror<TShape>, options?: OwnedOptions): Owned<TShape, "one">;
/** Declare an owned 1:N relationship (from `array({...})` or `array(mirror(...))`). */
export function owned<TShape extends OwnedShape>(
  set: OwnedArray<TShape>,
  options?: OwnedOptions,
): Owned<TShape, "many">;
export function owned(
  arg: OwnedShape | OwnedArray<OwnedShape> | Mirror<OwnedShape>,
  options: OwnedOptions = {},
): Owned<OwnedShape, OwnedCardinality> {
  if (arg instanceof OwnedArray) {
    return new Owned(arg.shape, "many", options, undefined, arg.mirrorName);
  }
  if (arg instanceof Mirror) {
    return new Owned(arg.extra, "one", options, undefined, arg.mirrorName);
  }
  return new Owned(arg, "one", options);
}
