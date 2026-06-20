import { describe, it, expect } from "vitest";
import { camelToSnake, indexName } from "../../src/util/naming.js";

describe("camelToSnake", () => {
  it("splits camelCase boundaries", () => {
    expect(camelToSnake("lastSeen")).toBe("last_seen");
    expect(camelToSnake("createdAt")).toBe("created_at");
    expect(camelToSnake("nearestCity")).toBe("nearest_city");
  });

  it("leaves single words untouched", () => {
    expect(camelToSnake("name")).toBe("name");
    expect(camelToSnake("email")).toBe("email");
  });

  it("does not emit a leading underscore", () => {
    expect(camelToSnake("Name")).toBe("name");
  });
});

describe("indexName", () => {
  it("follows the table_column_idx convention", () => {
    expect(indexName("users", "username")).toBe("users_username_idx");
  });
});
