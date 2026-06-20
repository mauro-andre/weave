/**
 * Column builder (Phase 1a).
 *
 * A `Column` wraps a {@link PgType} from the catalog and layers column-level
 * modifiers on top. It is **immutable**: every modifier returns a *new* column,
 * so type narrowing is correct and config never leaks between uses.
 *
 * Only **nullability** is tracked at the type level (it changes the read type:
 * `notNull → T`, otherwise `T | null`). `default`/`unique`/`index` are
 * runtime-only config for now — they affect DDL, not the read type. They rejoin
 * the type level when we build `save()`'s insert type (Phase 2/3).
 */

import type { PgType } from "../types/pg-type.js";
import type { Infer } from "../types/pg-type.js";

/** Runtime description of a column, consumed by the DDL layer. */
export interface ColumnConfig {
  /** The underlying catalog type. For arrays, the *element* type. */
  readonly pgType: PgType;
  /** Whether this is `type[]` rather than a scalar `type`. */
  readonly isArray: boolean;
  /** `NOT NULL` when true. */
  readonly notNull: boolean;
  /** Whether a default was declared. */
  readonly hasDefault: boolean;
  /** The declared default (literal value, or `[]` for arrays). Present iff `hasDefault`. */
  readonly default?: unknown;
  /** Single-column `UNIQUE`. */
  readonly unique: boolean;
  /** Single-column btree index. */
  readonly index: boolean;
}

/**
 * A column over data type `TData`, tracking nullability in `TNotNull`.
 *
 * @typeParam TData    - the TS value type (e.g. `string`, `string[]`).
 * @typeParam TNotNull - `true` once `.notNull()` (or an array default) applies.
 */
export class Column<TData, TNotNull extends boolean = false> {
  /** Phantom carrier so the compiler can recover `TData`/`TNotNull`. No runtime field. */
  declare readonly _types: { data: TData; notNull: TNotNull };

  constructor(readonly config: ColumnConfig) {}

  /** Mark the column `NOT NULL` — narrows the read type from `T | null` to `T`. */
  notNull(): Column<TData, true> {
    return new Column({ ...this.config, notNull: true });
  }

  /** Mark the column nullable — widens the read type back to `T | null`. */
  nullable(): Column<TData, false> {
    return new Column({ ...this.config, notNull: false });
  }

  /** Declare a default value (literal). Does not change the read type. */
  default(value: TData): Column<TData, TNotNull> {
    return new Column({ ...this.config, hasDefault: true, default: value });
  }

  /** Add a single-column `UNIQUE`. */
  unique(): Column<TData, TNotNull> {
    return new Column({ ...this.config, unique: true });
  }

  /** Add a single-column index. */
  index(): Column<TData, TNotNull> {
    return new Column({ ...this.config, index: true });
  }
}

/** A column of any shape — for constraints where the data type is irrelevant. */
export type AnyColumn = Column<unknown, boolean>;

/** The TS type a column reads as, accounting for nullability. */
export type InferColumn<C> =
  C extends Column<infer TData, infer TNotNull>
    ? TNotNull extends true
      ? TData
      : TData | null
    : never;

/** Build a fresh scalar column from a catalog type (nullable, no default). */
export function scalarColumn<T extends PgType>(pgType: T): Column<Infer<T>, false> {
  return new Column<Infer<T>, false>({
    pgType,
    isArray: false,
    notNull: false,
    hasDefault: false,
    unique: false,
    index: false,
  });
}
