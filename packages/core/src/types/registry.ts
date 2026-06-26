/**
 * Lookup structures over the catalog.
 *
 * `byName` and `byOid` are the runtime indexes used by the DDL/diff layer to
 * resolve a type from a shape declaration (by name) or from the live database
 * (by OID — what `pg_attribute` / wire metadata reports).
 */

import type { PgType } from "./pg-type.js";
import * as types from "./catalog.js";

/** Every catalog entry, keyed by its short Postgres name. */
export const catalog = {
  int2: types.int2,
  int4: types.int4,
  int8: types.int8,
  numeric: types.numeric,
  float4: types.float4,
  float8: types.float8,
  text: types.text,
  varchar: types.varchar,
  bpchar: types.bpchar,
  timestamptz: types.timestamptz,
  timestamp: types.timestamp,
  date: types.date,
  time: types.time,
  interval: types.interval,
  bool: types.bool,
  uuid: types.uuid,
  json: types.json,
  jsonb: types.jsonb,
  bytea: types.bytea,
} as const;

export type CatalogName = keyof typeof catalog;

/** All catalog entries as a flat list. */
export const allTypes: readonly PgType[] = Object.values(catalog);

/** Resolve a type by its short Postgres name (e.g. "int4"). */
export const byName: ReadonlyMap<string, PgType> = new Map(
  allTypes.map((t) => [t.name, t]),
);

/** Resolve a type by its Postgres OID (e.g. 23 → int4). */
export const byOid: ReadonlyMap<number, PgType> = new Map(
  allTypes.map((t) => [t.oid, t]),
);
