import { describe, it, expect } from "vitest";
import {
  array,
  collectTables,
  defineEntity,
  emitEntity,
  int4,
  owned,
  text,
} from "../../src/index.js";

/** The PRD canonical example, minus references (Phase 3). */
const user = defineEntity("users", {
  name: text().notNull(),
  email: text().notNull().unique(),
  addresses: owned(
    array({
      street: text().notNull(),
      landmarks: owned(
        array({
          label: text().notNull(),
        }),
      ),
    }),
  ),
});

describe("collectTables", () => {
  const specs = collectTables(user);

  it("produces one table per owned level, parent-first", () => {
    expect(specs.map((s) => s.name)).toEqual([
      "users",
      "user_addresses",
      "user_addresses_landmarks",
    ]);
  });

  it("owned fields do not become columns on the parent", () => {
    const root = specs[0]!;
    expect(root.columns.map((c) => c.name)).toEqual([
      "id",
      "name",
      "email",
      "created_at",
      "updated_at",
    ]);
  });

  it("child tables get the parent FK with cascade, named by parent segment", () => {
    const addresses = specs[1]!;
    const fk = addresses.columns.find((c) => c.name === "user_id");
    expect(fk).toMatchObject({
      sqlType: "uuid",
      notNull: true,
      references: { table: "users", cascade: true },
    });

    const landmarks = specs[2]!;
    const fk2 = landmarks.columns.find((c) => c.name === "address_id");
    expect(fk2).toMatchObject({ references: { table: "user_addresses", cascade: true } });
  });

  it("auto-indexes each parent FK", () => {
    expect(specs[1]!.indexes).toEqual([
      { name: "user_addresses_user_id_idx", column: "user_id" },
    ]);
    expect(specs[2]!.indexes).toEqual([
      { name: "user_addresses_landmarks_address_id_idx", column: "address_id" },
    ]);
  });
});

describe("emitEntity (owned tree)", () => {
  it("matches the PRD canonical DDL", () => {
    expect(emitEntity(user)).toBe(
      [
        "CREATE TABLE users (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  name text NOT NULL,",
        "  email text NOT NULL UNIQUE,",
        "  created_at timestamp with time zone NOT NULL DEFAULT now(),",
        "  updated_at timestamp with time zone NOT NULL DEFAULT now()",
        ");",
        "CREATE TABLE user_addresses (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
        "  street text NOT NULL,",
        "  created_at timestamp with time zone NOT NULL DEFAULT now(),",
        "  updated_at timestamp with time zone NOT NULL DEFAULT now()",
        ");",
        "CREATE INDEX user_addresses_user_id_idx ON user_addresses (user_id);",
        "CREATE TABLE user_addresses_landmarks (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  address_id uuid NOT NULL REFERENCES user_addresses(id) ON DELETE CASCADE,",
        "  label text NOT NULL,",
        "  created_at timestamp with time zone NOT NULL DEFAULT now(),",
        "  updated_at timestamp with time zone NOT NULL DEFAULT now()",
        ");",
        "CREATE INDEX user_addresses_landmarks_address_id_idx ON user_addresses_landmarks (address_id);",
      ].join("\n"),
    );
  });
});

describe("owned 1:1 and table override", () => {
  it("1:1 owned still gets a dedicated table", () => {
    const account = defineEntity("accounts", {
      profile: owned({ bio: text() }),
    });
    expect(collectTables(account).map((s) => s.name)).toEqual([
      "accounts",
      "account_profile",
    ]);
  });

  it("{ table } overrides the generated name", () => {
    const u = defineEntity("users", {
      addresses: owned(array({ street: text().notNull() }), { table: "addresses" }),
    });
    expect(collectTables(u).map((s) => s.name)).toEqual(["users", "addresses"]);
  });

  it("supports scalar arrays alongside owned in the same shape", () => {
    const u = defineEntity("users", {
      tags: array(text()),
      pets: owned(array({ name: int4().notNull() })),
    });
    const specs = collectTables(u);
    expect(specs[0]!.columns.find((c) => c.name === "tags")?.sqlType).toBe("text[]");
    expect(specs.map((s) => s.name)).toEqual(["users", "user_pets"]);
  });
});
