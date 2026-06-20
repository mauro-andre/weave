/**
 * The Postgres type catalog (Phase 0).
 *
 * Each Postgres type is described once, as a plain TS object that serves two
 * masters at the same time:
 *
 *   - runtime   → `oid` + `sqlType`: emit DDL and match columns against the live
 *                 database during a diff (Postgres speaks in OIDs, not names).
 *   - compile   → `tsType`: a *phantom* field carrying the corresponding TS type
 *                 so the shape can infer `number`/`string`/`Date`/... with zero
 *                 runtime cost. It is `undefined` at runtime.
 *
 * `tsLabel` is the runtime-visible string twin of `tsType` (e.g. "number"),
 * reserved for future codegen (edge validation / Zod) and debugging.
 */

/** Runtime-visible label of the TS type a column hydrates to. */
export type TsLabel =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "Date"
  | "Uint8Array"
  | "unknown";

/**
 * A single entry in the Postgres type catalog.
 *
 * @typeParam TName - the catalog key and discriminant (e.g. "int4").
 * @typeParam TTs   - the TS type a value of this column hydrates to.
 */
export interface PgType<TName extends string = string, TTs = unknown> {
  /** Catalog key + discriminant. Matches the short Postgres type name. */
  readonly name: TName;
  /** Canonical SQL text emitted in DDL (e.g. "integer", "timestamp with time zone"). */
  readonly sqlType: string;
  /** Stable Postgres OID (from `pg_type`), the robust key for diffing. */
  readonly oid: number;
  /** Runtime-visible twin of `tsType`, for codegen/debug. */
  readonly tsLabel: TsLabel;
  /**
   * Phantom carrier of the TS type. Always `undefined` at runtime — read it
   * only at the type level via {@link Infer}.
   */
  readonly tsType: TTs;
}

/** Definition object accepted by {@link defineType} (everything but the phantom). */
export interface PgTypeDef<TName extends string> {
  readonly name: TName;
  readonly sqlType: string;
  readonly oid: number;
  readonly tsLabel: TsLabel;
}

/**
 * Build a {@link PgType}, binding the runtime fields to the phantom `TTs` type.
 *
 * `TTs` is supplied explicitly (it has no runtime representation), while `TName`
 * is inferred from the literal `name`:
 *
 * ```ts
 * const int4 = defineType<number>({ name: "int4", sqlType: "integer", oid: 23, tsLabel: "number" });
 * ```
 */
export function defineType<TTs>() {
  return <TName extends string>(def: PgTypeDef<TName>): PgType<TName, TTs> => ({
    ...def,
    // Phantom: exists only so the compiler can recover `TTs`. Never read at runtime.
    tsType: undefined as TTs,
  });
}

/** Extract the TS type a {@link PgType} hydrates to. */
export type Infer<T extends PgType> = T["tsType"];
