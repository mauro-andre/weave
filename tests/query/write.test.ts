import { describe, it, expect } from "vitest";
import { renderInsert, renderUpsert } from "../../app/engine/index.js";

describe("renderInsert", () => {
  it("builds a parameterized insert returning id", () => {
    expect(renderInsert("users", ["name", "email"])).toBe(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
    );
  });

  it("uses DEFAULT VALUES when there are no columns", () => {
    expect(renderInsert("users", [])).toBe("INSERT INTO users DEFAULT VALUES RETURNING id");
  });
});

describe("renderUpsert", () => {
  it("upserts on id conflict and bumps updated_at", () => {
    expect(renderUpsert("users", ["id", "name", "email"])).toBe(
      "INSERT INTO users (id, name, email) VALUES ($1, $2, $3) " +
        "ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email, " +
        "updated_at = now() RETURNING id",
    );
  });

  it("still bumps updated_at when only id is given", () => {
    expect(renderUpsert("users", ["id"])).toBe(
      "INSERT INTO users (id) VALUES ($1) " +
        "ON CONFLICT (id) DO UPDATE SET updated_at = now() RETURNING id",
    );
  });
});
