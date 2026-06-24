import { describe, it, expect } from "vitest";
import {
  array,
  collectTables,
  compileFind,
  defineEntity,
  planTables,
  reference,
  renderCreateTable,
  text,
} from "../../app/engine/index.js";

const tag = defineEntity("tags", { label: text().notNull() });
const post = defineEntity("posts", {
  title: text().notNull(),
  tags: reference(array(tag)),
});

describe("N:N DDL", () => {
  const specs = collectTables(post);

  it("emits a join table (no id/timestamps), composite PK", () => {
    expect(specs.map((s) => s.name)).toEqual(["posts", "post__tags"]);
    const join = specs[1]!;
    expect(join.primaryKey).toEqual(["post_id", "tag_id"]);
    expect(join.columns.map((c) => c.name)).toEqual(["post_id", "tag_id"]);
  });

  it("both FKs cascade the link; target FK is indexed", () => {
    const join = specs[1]!;
    expect(join.columns.find((c) => c.name === "post_id")!.references).toEqual({
      table: "posts",
      cascade: true,
    });
    expect(join.columns.find((c) => c.name === "tag_id")!.references).toEqual({
      table: "tags",
      cascade: true,
    });
    expect(join.indexes).toEqual([{ name: "post__tags_tag_id_idx", column: "tag_id" }]);
  });

  it("renders the composite primary key", () => {
    expect(renderCreateTable(specs[1]!)).toBe(
      [
        "CREATE TABLE post__tags (",
        "  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,",
        "  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,",
        "  PRIMARY KEY (post_id, tag_id)",
        ");",
      ].join("\n"),
    );
  });
});

describe("planTables (topological order)", () => {
  it("orders referenced tables before the tables referencing them", () => {
    // posts references tags (via join); declared in the 'wrong' order.
    const specs = [...collectTables(post), ...collectTables(tag)];
    const ordered = planTables(specs).map((s) => s.name);
    expect(ordered.indexOf("tags")).toBeLessThan(ordered.indexOf("post__tags"));
    expect(ordered.indexOf("posts")).toBeLessThan(ordered.indexOf("post__tags"));
  });
});

describe("N:N read compile", () => {
  it("brings nothing by default", () => {
    const sql = compileFind(post).text;
    expect(sql).not.toContain("post__tags");
    expect(sql).not.toContain("'tags'");
  });

  it("aggregates linked targets via the join table on expand", () => {
    const sql = compileFind(post, { expand: { tags: true } }).text;
    expect(sql).toContain(
      "'tags', (SELECT coalesce(json_agg(json_build_object('id', tags.id, 'label', tags.label, " +
        "'createdAt', tags.created_at, 'updatedAt', tags.updated_at) ORDER BY tags.created_at), '[]'::json) " +
        "FROM tags JOIN post__tags ON post__tags.tag_id = tags.id WHERE post__tags.post_id = posts.id)",
    );
  });
});
