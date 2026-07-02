import { describe, it, expect } from "vitest";
import {
  collectTables,
  compileFind,
  defineEntity,
  owned,
  array,
  reference,
  text,
} from "../../app/engine/index.js";

const city = defineEntity("cities", { name: text().notNull() });

const user = defineEntity("users", {
  name: text().notNull(),
  city: reference(city), // nullable FK
  homeCity: reference(city).notNull(), // notNull FK, camelCase → home_city_id
});

describe("reference DDL", () => {
  const root = collectTables(user)[0]!;

  it("emits an FK column (no cascade), auto-indexed", () => {
    const fk = root.columns.find((c) => c.name === "city_id");
    expect(fk).toMatchObject({
      sqlType: "uuid",
      notNull: false,
      references: { table: "cities", cascade: false },
    });
    expect(root.indexes).toContainEqual({ name: "users_city_id_idx", column: "city_id" });
  });

  it("honors notNull and snake_cases the column", () => {
    const fk = root.columns.find((c) => c.name === "home_city_id");
    expect(fk).toMatchObject({ notNull: true, references: { table: "cities", cascade: false } });
  });

  it("does not create a child table for the reference", () => {
    expect(collectTables(user).map((s) => s.name)).toEqual(["users"]);
  });
});

describe("reference read compile", () => {
  it("includes <field>Id by default, no join", () => {
    const sql = compileFind(user).text;
    expect(sql).toContain("'cityId', users.city_id");
    expect(sql).not.toContain("FROM cities");
  });

  it("adds the expanded object subquery when expanded", () => {
    const sql = compileFind(user, { expand: { city: true } }).text;
    expect(sql).toContain("'cityId', users.city_id");
    expect(sql).toContain(
      "'city', (SELECT json_build_object('id', cities.id, 'name', cities.name, " +
        "'createdAt', cities.created_at, 'updatedAt', cities.updated_at) " +
        "FROM cities WHERE cities.id = users.city_id LIMIT 1)",
    );
  });

  it("expands references nested inside owned children", () => {
    const u = defineEntity("users", {
      addresses: owned(array({ city: reference(city) })),
    });
    const sql = compileFind(u, { expand: { addresses: { city: true } } }).text;
    expect(sql).toContain("'cityId', users__addresses.city_id");
    expect(sql).toContain("FROM cities WHERE cities.id = users__addresses.city_id LIMIT 1");
  });
});
