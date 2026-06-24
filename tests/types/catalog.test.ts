import { describe, it, expect } from "vitest";
import { allTypes, catalog } from "../../app/engine/types/index.js";

/**
 * Each entry's runtime facts. OIDs are the stable Postgres `pg_type` values;
 * if any of these drift, the diff layer would silently mismatch the database.
 */
const EXPECTED = {
  int2: { sqlType: "smallint", oid: 21, tsLabel: "number" },
  int4: { sqlType: "integer", oid: 23, tsLabel: "number" },
  int8: { sqlType: "bigint", oid: 20, tsLabel: "bigint" },
  numeric: { sqlType: "numeric", oid: 1700, tsLabel: "number" },
  float4: { sqlType: "real", oid: 700, tsLabel: "number" },
  float8: { sqlType: "double precision", oid: 701, tsLabel: "number" },
  text: { sqlType: "text", oid: 25, tsLabel: "string" },
  varchar: { sqlType: "varchar", oid: 1043, tsLabel: "string" },
  bpchar: { sqlType: "char", oid: 1042, tsLabel: "string" },
  timestamptz: { sqlType: "timestamp with time zone", oid: 1184, tsLabel: "Date" },
  timestamp: { sqlType: "timestamp", oid: 1114, tsLabel: "Date" },
  date: { sqlType: "date", oid: 1082, tsLabel: "Date" },
  time: { sqlType: "time", oid: 1083, tsLabel: "string" },
  interval: { sqlType: "interval", oid: 1186, tsLabel: "string" },
  bool: { sqlType: "boolean", oid: 16, tsLabel: "boolean" },
  uuid: { sqlType: "uuid", oid: 2950, tsLabel: "string" },
  json: { sqlType: "json", oid: 114, tsLabel: "unknown" },
  jsonb: { sqlType: "jsonb", oid: 3802, tsLabel: "unknown" },
  bytea: { sqlType: "bytea", oid: 17, tsLabel: "Uint8Array" },
} as const;

describe("catalog entries", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} has the right sqlType / oid / tsLabel`, () => {
      const entry = catalog[name as keyof typeof catalog];
      expect(entry.name).toBe(name);
      expect(entry.sqlType).toBe(expected.sqlType);
      expect(entry.oid).toBe(expected.oid);
      expect(entry.tsLabel).toBe(expected.tsLabel);
    });
  }

  it("covers exactly the expected set", () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("each entry's name matches its catalog key", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      expect(entry.name).toBe(key);
    }
  });

  it("the phantom tsType is undefined at runtime", () => {
    for (const entry of allTypes) {
      expect(entry.tsType).toBeUndefined();
    }
  });
});
