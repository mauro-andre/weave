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
  ) {}

  /** Pin a stable field id (survives rename). Normally emitted by `weave gen`. */
  $id(id: string): Owned<TShape, TCard> {
    return new Owned(this.shape, this.cardinality, this.options, id);
  }
}

/** An owned relationship of any shape/cardinality. */
export type AnyOwned = Owned<OwnedShape, OwnedCardinality>;

/** Marker produced by `array({...})` to signal a 1:N owned set. */
export class OwnedArray<TShape extends OwnedShape> {
  readonly kind = "owned_array" as const;
  constructor(readonly shape: TShape) {}
}

/** Declare an owned 1:1 relationship. */
export function owned<TShape extends OwnedShape>(
  shape: TShape,
  options?: OwnedOptions,
): Owned<TShape, "one">;
/** Declare an owned 1:N relationship (from `array({...})`). */
export function owned<TShape extends OwnedShape>(
  set: OwnedArray<TShape>,
  options?: OwnedOptions,
): Owned<TShape, "many">;
export function owned(
  arg: OwnedShape | OwnedArray<OwnedShape>,
  options: OwnedOptions = {},
): Owned<OwnedShape, OwnedCardinality> {
  if (arg instanceof OwnedArray) {
    return new Owned(arg.shape, "many", options);
  }
  return new Owned(arg, "one", options);
}
