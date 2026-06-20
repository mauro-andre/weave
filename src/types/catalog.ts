/**
 * The core Postgres type catalog (~20 scalars) for v1.
 *
 * OIDs are the stable values hardcoded in Postgres' `pg_type` (mirrored by
 * `pg-types`' `builtins`). `sqlType` is the canonical SQL spelling emitted in
 * DDL. The TS mapping follows the decisions in the PRD:
 *
 *   - int8    → bigint   (number can't hold it losslessly)
 *   - numeric → number   (ergonomics over precision; column stays exact)
 *   - date/timestamp(tz) → Date
 *   - time/interval      → string  (no native JS type; lossless as text)
 *   - json/jsonb         → unknown (schemaless by nature)
 *   - bytea              → Uint8Array
 *
 * Exotic types (ranges, network, geometric, tsvector) are intentionally out of
 * scope for v1.
 */

import { defineType } from "./pg-type.js";

// ── Numeric ────────────────────────────────────────────────────────────────
export const int2 = defineType<number>()({ name: "int2", sqlType: "smallint", oid: 21, tsLabel: "number" });
export const int4 = defineType<number>()({ name: "int4", sqlType: "integer", oid: 23, tsLabel: "number" });
export const int8 = defineType<bigint>()({ name: "int8", sqlType: "bigint", oid: 20, tsLabel: "bigint" });
export const numeric = defineType<number>()({ name: "numeric", sqlType: "numeric", oid: 1700, tsLabel: "number" });
export const float4 = defineType<number>()({ name: "float4", sqlType: "real", oid: 700, tsLabel: "number" });
export const float8 = defineType<number>()({ name: "float8", sqlType: "double precision", oid: 701, tsLabel: "number" });

// ── Text ─────────────────────────────────────────────────────────────────────
export const text = defineType<string>()({ name: "text", sqlType: "text", oid: 25, tsLabel: "string" });
export const varchar = defineType<string>()({ name: "varchar", sqlType: "varchar", oid: 1043, tsLabel: "string" });
export const bpchar = defineType<string>()({ name: "bpchar", sqlType: "char", oid: 1042, tsLabel: "string" });

// ── Date / time ──────────────────────────────────────────────────────────────
export const timestamptz = defineType<Date>()({ name: "timestamptz", sqlType: "timestamp with time zone", oid: 1184, tsLabel: "Date" });
export const timestamp = defineType<Date>()({ name: "timestamp", sqlType: "timestamp", oid: 1114, tsLabel: "Date" });
export const date = defineType<Date>()({ name: "date", sqlType: "date", oid: 1082, tsLabel: "Date" });
export const time = defineType<string>()({ name: "time", sqlType: "time", oid: 1083, tsLabel: "string" });
export const interval = defineType<string>()({ name: "interval", sqlType: "interval", oid: 1186, tsLabel: "string" });

// ── Boolean ──────────────────────────────────────────────────────────────────
export const bool = defineType<boolean>()({ name: "bool", sqlType: "boolean", oid: 16, tsLabel: "boolean" });

// ── Identity ─────────────────────────────────────────────────────────────────
export const uuid = defineType<string>()({ name: "uuid", sqlType: "uuid", oid: 2950, tsLabel: "string" });

// ── Document ─────────────────────────────────────────────────────────────────
export const json = defineType<unknown>()({ name: "json", sqlType: "json", oid: 114, tsLabel: "unknown" });
export const jsonb = defineType<unknown>()({ name: "jsonb", sqlType: "jsonb", oid: 3802, tsLabel: "unknown" });

// ── Binary ───────────────────────────────────────────────────────────────────
export const bytea = defineType<Uint8Array>()({ name: "bytea", sqlType: "bytea", oid: 17, tsLabel: "Uint8Array" });
