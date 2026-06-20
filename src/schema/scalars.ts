/**
 * Public column constructors — the shape-declaration surface.
 *
 * Each constructor returns a fresh, nullable {@link Column} over the matching
 * catalog type. Chain modifiers to refine it: `text().notNull().unique()`.
 */

import { catalog } from "../types/registry.js";
import { Column, scalarColumn, type AnyColumn } from "./column.js";

// ── Numeric ──────────────────────────────────────────────────────────────────
export const int2 = () => scalarColumn(catalog.int2);
export const int4 = () => scalarColumn(catalog.int4);
export const int8 = () => scalarColumn(catalog.int8);
export const numeric = () => scalarColumn(catalog.numeric);
export const float4 = () => scalarColumn(catalog.float4);
export const float8 = () => scalarColumn(catalog.float8);

// ── Text ─────────────────────────────────────────────────────────────────────
export const text = () => scalarColumn(catalog.text);
export const varchar = () => scalarColumn(catalog.varchar);
export const bpchar = () => scalarColumn(catalog.bpchar);

// ── Date / time ──────────────────────────────────────────────────────────────
export const timestamptz = () => scalarColumn(catalog.timestamptz);
export const timestamp = () => scalarColumn(catalog.timestamp);
export const date = () => scalarColumn(catalog.date);
export const time = () => scalarColumn(catalog.time);
export const interval = () => scalarColumn(catalog.interval);

// ── Boolean ──────────────────────────────────────────────────────────────────
export const bool = () => scalarColumn(catalog.bool);

// ── Identity ─────────────────────────────────────────────────────────────────
export const uuid = () => scalarColumn(catalog.uuid);

// ── Document ─────────────────────────────────────────────────────────────────
export const json = () => scalarColumn(catalog.json);
export const jsonb = () => scalarColumn(catalog.jsonb);

// ── Binary ───────────────────────────────────────────────────────────────────
export const bytea = () => scalarColumn(catalog.bytea);

/**
 * Wrap a scalar column into an array column (`type[]`).
 *
 * Per the PRD canonical example, arrays default to **`NOT NULL DEFAULT '{}'`**:
 * you always get `[]`, never `null`. Opt into a nullable array with
 * `array(text()).nullable()`.
 */
export function array<TData, TNotNull extends boolean>(
  inner: Column<TData, TNotNull>,
): Column<TData[], true> {
  return new Column<TData[], true>({
    pgType: inner.config.pgType,
    isArray: true,
    notNull: true,
    hasDefault: true,
    default: [],
    unique: false,
    index: false,
  });
}

export type { AnyColumn };
