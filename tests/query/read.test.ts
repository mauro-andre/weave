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
          "'id', user_addresses.id, " +
          "'street', user_addresses.street, " +
          "'landmarks', (SELECT coalesce(json_agg(json_build_object(" +
          "'id', user_addresses_landmarks.id, " +
          "'label', user_addresses_landmarks.label, " +
          "'createdAt', user_addresses_landmarks.created_at, " +
          "'updatedAt', user_addresses_landmarks.updated_at) " +
          "ORDER BY user_addresses_landmarks.created_at), '[]'::json) " +
          "FROM user_addresses_landmarks WHERE user_addresses_landmarks.address_id = user_addresses.id), " +
          "'createdAt', user_addresses.created_at, " +
          "'updatedAt', user_addresses.updated_at) " +
          "ORDER BY user_addresses.created_at), '[]'::json) " +
          "FROM user_addresses WHERE user_addresses.user_id = users.id), " +
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
      "'profile', (SELECT json_build_object('id', account_profile.id, " +
        "'bio', account_profile.bio, " +
        "'createdAt', account_profile.created_at, " +
        "'updatedAt', account_profile.updated_at) " +
        "FROM account_profile WHERE account_profile.account_id = accounts.id LIMIT 1)",
    );
  });
});
