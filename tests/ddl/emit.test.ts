import { describe, it, expect } from "vitest";
import {
  array,
  bool,
  defineEntity,
  emitCreateTable,
  emitEntity,
  emitIndexes,
  int4,
  text,
  timestamptz,
} from "../../app/engine/index.js";

describe("emitCreateTable", () => {
  it("emits the canonical scalar + array table", () => {
    const user = defineEntity("users", {
      name: text().notNull(),
      email: text().notNull().unique(),
      bio: text(),
      age: int4().notNull().default(0),
      active: bool().notNull().default(true),
      phones: array(text()),
      lastSeen: timestamptz(),
    });

    expect(emitCreateTable(user)).toBe(
      [
        "CREATE TABLE users (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  name text NOT NULL,",
        "  email text NOT NULL UNIQUE,",
        "  bio text,",
        "  age integer NOT NULL DEFAULT 0,",
        "  active boolean NOT NULL DEFAULT true,",
        "  phones text[] NOT NULL DEFAULT '{}',",
        "  last_seen timestamp with time zone,",
        "  created_at timestamp with time zone NOT NULL DEFAULT now(),",
        "  updated_at timestamp with time zone NOT NULL DEFAULT now()",
        ");",
      ].join("\n"),
    );
  });

  it("escapes single quotes in string defaults", () => {
    const t = defineEntity("notes", { label: text().notNull().default("a'b") });
    expect(emitCreateTable(t)).toContain("label text NOT NULL DEFAULT 'a''b'");
  });
});

describe("emitIndexes", () => {
  it("emits one CREATE INDEX per .index() column", () => {
    const user = defineEntity("users", {
      username: text().notNull().index(),
      bio: text(),
      slug: text().index(),
    });
    expect(emitIndexes(user)).toEqual([
      "CREATE INDEX users_username_idx ON users (username);",
      "CREATE INDEX users_slug_idx ON users (slug);",
    ]);
  });

  it("returns nothing when no column is indexed", () => {
    const t = defineEntity("plain", { a: text() });
    expect(emitIndexes(t)).toEqual([]);
  });
});

describe("emitEntity", () => {
  it("joins the table and its indexes", () => {
    const t = defineEntity("users", { username: text().notNull().index() });
    const out = emitEntity(t);
    expect(out).toContain("CREATE TABLE users (");
    expect(out.trimEnd().endsWith("CREATE INDEX users_username_idx ON users (username);")).toBe(true);
  });
});
