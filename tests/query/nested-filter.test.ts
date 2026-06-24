import { describe, it, expect } from "vitest";
import { array, compileFind, defineEntity, owned, reference, text } from "../../app/engine/index.js";

const tag = defineEntity("tags", { label: text().notNull() });
const author = defineEntity("authors", { name: text().notNull() });

const post = defineEntity("posts", {
  title: text().notNull(),
  keywords: array(text()),
  author: reference(author),
  tags: reference(array(tag)),
  comments: owned(array({ body: text().notNull(), approved: text() })),
});

function whereOf(opts: Parameters<typeof compileFind<typeof post>>[1]) {
  const { text: sql, params } = compileFind(post, opts);
  return { where: sql.split("\n").find((l) => l.startsWith("WHERE"))!.replace(/^WHERE /, ""), params };
}

describe("array column operators", () => {
  it("has → = ANY", () => {
    expect(whereOf({ where: { keywords: { has: "ts" } } })).toEqual({
      where: "$1 = ANY(posts.keywords)",
      params: ["ts"],
    });
  });
  it("hasSome → && ARRAY, hasEvery → @> ARRAY", () => {
    expect(whereOf({ where: { keywords: { hasSome: ["a", "b"] } } }).where).toBe(
      "posts.keywords && ARRAY[$1, $2]",
    );
    expect(whereOf({ where: { keywords: { hasEvery: ["a"] } } }).where).toBe(
      "posts.keywords @> ARRAY[$1]",
    );
  });
  it("isEmpty → cardinality", () => {
    expect(whereOf({ where: { keywords: { isEmpty: true } } }).where).toBe(
      "cardinality(posts.keywords) = 0",
    );
  });
});

describe("reference N:1 nested filter", () => {
  it("nested → EXISTS on target", () => {
    expect(whereOf({ where: { author: { name: { ilike: "mau%" } } } }).where).toBe(
      "EXISTS (SELECT 1 FROM authors WHERE authors.id = posts.author_id AND authors.name ILIKE $1)",
    );
  });
  it("<field>Id filters the FK directly, no join", () => {
    expect(whereOf({ where: { authorId: "a-1" } })).toEqual({
      where: "posts.author_id = $1",
      params: ["a-1"],
    });
  });
});

describe("owned 1:N quantifiers", () => {
  it("some → EXISTS", () => {
    expect(whereOf({ where: { comments: { some: { approved: "yes" } } } }).where).toBe(
      "EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = posts.id AND post_comments.approved = $1)",
    );
  });
  it("none → NOT EXISTS", () => {
    expect(whereOf({ where: { comments: { none: {} } } }).where).toBe(
      "NOT EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = posts.id)",
    );
  });
  it("every → NOT EXISTS(... AND NOT ...)", () => {
    expect(whereOf({ where: { comments: { every: { approved: "yes" } } } }).where).toBe(
      "NOT EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = posts.id AND NOT (post_comments.approved = $1))",
    );
  });
});

describe("reference N:N quantifier", () => {
  it("some → EXISTS over join", () => {
    expect(whereOf({ where: { tags: { some: { label: "sql" } } } }).where).toBe(
      "EXISTS (SELECT 1 FROM tags JOIN post_tags ON post_tags.tag_id = tags.id " +
        "WHERE post_tags.post_id = posts.id AND tags.label = $1)",
    );
  });
});

describe("recursion + composition", () => {
  it("nests quantifiers and combines with logic", () => {
    const { where } = whereOf({
      where: {
        and: [{ title: { ilike: "%x%" } }, { tags: { some: { label: "sql" } } }],
      },
    });
    expect(where).toBe(
      "(posts.title ILIKE $1 AND EXISTS (SELECT 1 FROM tags JOIN post_tags " +
        "ON post_tags.tag_id = tags.id WHERE post_tags.post_id = posts.id AND tags.label = $2))",
    );
  });
});
