/**
 * Column builder (Phase 1a; `hasDefault` added at the type level in Phase 2c).
 *
 * A `Column` wraps a {@link PgType} from the catalog and layers column-level
 * modifiers on top. It is **immutable**: every modifier returns a *new* column,
 * so type narrowing is correct and config never leaks between uses.
 *
 * Two facts are tracked at the type level:
 *   - **nullability** (`TNotNull`): changes the *read* type (`T` vs `T | null`).
 *   - **hasDefault** (`THasDefault`): changes the *insert* type — a notNull
 *     column with a default becomes optional on insert (the DB fills it).
 */

import type { PgType, Infer } from "../types/pg-type.js";

/** Runtime description of a column, consumed by the DDL layer. */
export interface ColumnConfig {
  /** Stable field id (UUID) — survives rename. Normally born from `weave gen`; absent for hand-written, id-less fields. */
  readonly id?: string;
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
 * A column over data type `TData`.
 *
 * @typeParam TData       - the TS value type (e.g. `string`, `string[]`).
 * @typeParam TNotNull    - `true` once `.notNull()` (or an array default) applies.
 * @typeParam THasDefault - `true` once a default exists (`.default()` or array).
 */
export class Column<
  TData,
  TNotNull extends boolean = false,
  THasDefault extends boolean = false,
> {
  /** Phantom carrier so the compiler can recover the type params. No runtime field. */
  declare readonly _types: { data: TData; notNull: TNotNull; hasDefault: THasDefault };

  constructor(readonly config: ColumnConfig) {}

  /** Mark the column `NOT NULL` — narrows the read type from `T | null` to `T`. */
  notNull(): Column<TData, true, THasDefault> {
    return new Column({ ...this.config, notNull: true });
  }

  /** Mark the column nullable — widens the read type back to `T | null`. */
  nullable(): Column<TData, false, THasDefault> {
    return new Column({ ...this.config, notNull: false });
  }

  /** Declare a default value — makes the column optional on insert. */
  default(value: TData): Column<TData, TNotNull, true> {
    return new Column({ ...this.config, hasDefault: true, default: value });
  }

  /** Add a single-column `UNIQUE`. */
  unique(): Column<TData, TNotNull, THasDefault> {
    return new Column({ ...this.config, unique: true });
  }

  /** Add a single-column index. */
  index(): Column<TData, TNotNull, THasDefault> {
    return new Column({ ...this.config, index: true });
  }

  /** Pin a stable field id (survives rename). Normally emitted by `weave gen`. */
  $id(id: string): Column<TData, TNotNull, THasDefault> {
    return new Column({ ...this.config, id });
  }
}

/** A column of any shape — for constraints where the data type is irrelevant. */
export type AnyColumn = Column<unknown, boolean, boolean>;

/** The TS type a column reads as, accounting for nullability. */
export type InferColumn<C> =
  C extends Column<infer TData, infer TNotNull, boolean>
    ? TNotNull extends true
      ? TData
      : TData | null
    : never;

/** Build a fresh scalar column from a catalog type (nullable, no default). */
export function scalarColumn<T extends PgType>(pgType: T): Column<Infer<T>, false, false> {
  return new Column<Infer<T>, false, false>({
    pgType,
    isArray: false,
    notNull: false,
    hasDefault: false,
    unique: false,
    index: false,
  });
}
