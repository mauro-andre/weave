/**
 * Rehydration (Phase 2b).
 *
 * JSON aggregation flattens values to text/number, so a shape-guided pass
 * restores the TS types the catalog promised:
 *
 *   - `timestamptz`/`timestamp`/`date` (tsLabel "Date") → `Date`.
 *   - `int8` (tsLabel "bigint")                         → `bigint`.
 *   - everything else passes through as-is.
 *
 * `id` stays a string; `createdAt`/`updatedAt` are rehydrated to `Date`.
 *
 * Note: JSON numbers lose precision above 2^53, so very large `int8` values can
 * already be lossy by the time they reach here — a known v1 limitation.
 */

import { Column } from "../schema/column.js";
import type { ShapeRecord } from "../schema/entity.js";
import { Owned, type OwnedShape } from "../schema/owned.js";
import { Reference } from "../schema/reference.js";
import type { TsLabel } from "../types/pg-type.js";

function rehydrateScalar(label: TsLabel, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (label) {
    case "Date":
      return new Date(value as string);
    case "bigint":
      return BigInt(value as number | string);
    default:
      return value;
  }
}

/** Rehydrate one (sub-)object in place, guided by its shape. */
export function rehydrate<T extends Record<string, unknown>>(
  shape: ShapeRecord | OwnedShape,
  obj: T,
): T {
  obj["createdAt" as keyof T] = new Date(obj["createdAt"] as string) as T[keyof T];
  obj["updatedAt" as keyof T] = new Date(obj["updatedAt"] as string) as T[keyof T];

  for (const [field, value] of Object.entries(shape)) {
    const current = obj[field];
    if (value instanceof Column) {
      const { tsLabel } = value.config.pgType;
      obj[field as keyof T] = (
        value.config.isArray && Array.isArray(current)
          ? current.map((v) => rehydrateScalar(tsLabel, v))
          : rehydrateScalar(tsLabel, current)
      ) as T[keyof T];
    } else if (value instanceof Owned) {
      if (value.cardinality === "many" && Array.isArray(current)) {
        obj[field as keyof T] = current.map((row) =>
          rehydrate(value.shape, row as Record<string, unknown>),
        ) as T[keyof T];
      } else if (value.cardinality === "one" && current != null) {
        obj[field as keyof T] = rehydrate(
          value.shape,
          current as Record<string, unknown>,
        ) as T[keyof T];
      }
    } else if (value instanceof Reference) {
      // Only the expanded target object needs rehydration; `<field>Id` stays a string.
      if (current != null && typeof current === "object") {
        obj[field as keyof T] = rehydrate(
          value.target.columns,
          current as Record<string, unknown>,
        ) as T[keyof T];
      }
    }
  }

  return obj;
}
