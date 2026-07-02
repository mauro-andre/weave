import { describe, it, expect } from "vitest";
import { array, compileFind, defineEntity, owned, text } from "../../app/engine/index.js";

const user = defineEntity("users", {
  name: text().notNull(),
  email: text().notNull(),
  addresses: owned(
    array({
      street: text().notNull(),
      landmarks: owned(array({ label: text().notNull() })),
    }),
  ),
});

describe("compileFind", () => {
  it("nests owned via correlated JSON subqueries", () => {
    const { text: sql, params } = compileFind(user);
    expect(params).toEqual([]);
    expect(sql).toBe(
      [
        "SELECT json_build_object(" +
          "'id', users.id, " +
          "'name', users.name, " +
          "'email', users.email, " +
          "'addresses', (SELECT coalesce(json_agg(json_build_object(" +
          "'id', users__addresses.id, " +
          "'street', users__addresses.street, " +
          "'landmarks', (SELECT coalesce(json_agg(json_build_object(" +
          "'id', users__addresses__landmarks.id, " +
          "'label', users__addresses__landmarks.label, " +
          "'createdAt', users__addresses__landmarks.created_at, " +
          "'updatedAt', users__addresses__landmarks.updated_at) " +
          "ORDER BY users__addresses__landmarks.created_at), '[]'::json) " +
          "FROM users__addresses__landmarks WHERE users__addresses__landmarks.addresses_id = users__addresses.id), " +
          "'createdAt', users__addresses.created_at, " +
          "'updatedAt', users__addresses.updated_at) " +
          "ORDER BY users__addresses.created_at), '[]'::json) " +
          "FROM users__addresses WHERE users__addresses.users_id = users.id), " +
          "'createdAt', users.created_at, " +
          "'updatedAt', users.updated_at) AS data",
        "FROM users",
        "ORDER BY users.created_at",
      ].join("\n"),
    );
  });

  it("parameterizes a where filter on root columns", () => {
    const { text: sql, params } = compileFind(user, { where: { email: "m@x.com" } });
    expect(params).toEqual(["m@x.com"]);
    expect(sql).toContain("WHERE users.email = $1");
  });

  it("compiles a 1:1 owned as a single-object subquery", () => {
    const account = defineEntity("accounts", { profile: owned({ bio: text() }) });
    const { text: sql } = compileFind(account);
    expect(sql).toContain(
      "'profile', (SELECT json_build_object('id', accounts__profile.id, " +
        "'bio', accounts__profile.bio, " +
        "'createdAt', accounts__profile.created_at, " +
        "'updatedAt', accounts__profile.updated_at) " +
        "FROM accounts__profile WHERE accounts__profile.accounts_id = accounts.id LIMIT 1)",
    );
  });
});
