import { describe, it, expect } from "vitest";
import {
  collectTables,
  defineEntity,
  diffSchema,
  emitChanges,
  int4,
  text,
  type ActualSchema,
} from "../../app/engine/index.js";

const user = defineEntity("users", {
  name: text().notNull(),
  age: int4().index(),
});

const desired = collectTables(user);

/** Build an actual-schema with the given columns/indexes for `users`. */
function actual(cols: [string, { udtName: string; notNull: boolean }][], indexes: string[]): ActualSchema {
  return new Map([
    [
      "users",
      {
        name: "users",
        columns: new Map(cols.map(([n, c]) => [n, { name: n, isArray: false, ...c }])),
        indexes: new Set(indexes),
        foreignKeys: new Set(),
      },
    ],
  ]);
}

describe("diffSchema", () => {
  it("creates a table absent in the DB", () => {
    const cs = diffSchema(desired, new Map());
    expect(cs.createTables.map((t) => t.name)).toEqual(["users"]);
    expect(cs.addColumns).toEqual([]);
  });

  it("adds a missing column on an existing table", () => {
    const cs = diffSchema(
      desired,
      actual(
        [
          ["id", { udtName: "uuid", notNull: true }],
          ["name", { udtName: "text", notNull: true }],
          ["created_at", { udtName: "timestamptz", notNull: true }],
          ["updated_at", { udtName: "timestamptz", notNull: true }],
        ],
        ["users_pkey"],
      ),
    );
    expect(cs.createTables).toEqual([]);
    expect(cs.addColumns.map((c) => c.column.name)).toEqual(["age"]);
    expect(cs.addIndexes.map((i) => i.index.name)).toEqual(["users_age_idx"]);
  });

  it("reports type and nullability drift without altering", () => {
    const cs = diffSchema(
      desired,
      actual(
        [
          ["id", { udtName: "uuid", notNull: true }],
          ["name", { udtName: "int4", notNull: false }], // wrong type + nullability
          ["age", { udtName: "int4", notNull: false }],
          ["created_at", { udtName: "timestamptz", notNull: true }],
          ["updated_at", { udtName: "timestamptz", notNull: true }],
        ],
        ["users_pkey", "users_age_idx"],
      ),
    );
    expect(cs.addColumns).toEqual([]);
    expect(cs.warnings.some((w) => w.includes("type drift"))).toBe(true);
    expect(cs.warnings.some((w) => w.includes("nullability drift"))).toBe(true);
  });

  it("reports a column present only in the DB (never drops)", () => {
    const cs = diffSchema(
      desired,
      actual(
        [
          ["id", { udtName: "uuid", notNull: true }],
          ["name", { udtName: "text", notNull: true }],
          ["age", { udtName: "int4", notNull: false }],
          ["legacy", { udtName: "text", notNull: false }],
          ["created_at", { udtName: "timestamptz", notNull: true }],
          ["updated_at", { udtName: "timestamptz", notNull: true }],
        ],
        ["users_pkey", "users_age_idx"],
      ),
    );
    expect(cs.warnings.some((w) => w.includes("legacy") && w.includes("not dropped"))).toBe(true);
  });
});

describe("emitChanges", () => {
  it("renders ADD COLUMN + CREATE INDEX for additive changes", () => {
    const cs = diffSchema(
      desired,
      actual(
        [
          ["id", { udtName: "uuid", notNull: true }],
          ["name", { udtName: "text", notNull: true }],
          ["created_at", { udtName: "timestamptz", notNull: true }],
          ["updated_at", { udtName: "timestamptz", notNull: true }],
        ],
        ["users_pkey"],
      ),
    );
    const { statements } = emitChanges(cs);
    expect(statements).toEqual([
      "ALTER TABLE users ADD COLUMN age integer;",
      "CREATE INDEX users_age_idx ON users (age);",
    ]);
  });
});
