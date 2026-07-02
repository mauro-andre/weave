import { describe, it, expect } from "vitest";
import { array, compileFind, defineEntity, owned, reference, text } from "../../app/engine/index.js";

const author = defineEntity("authors", { name: text().notNull(), email: text().notNull() });
const post = defineEntity("posts", {
  title: text().notNull(),
  body: text().notNull(),
  author: reference(author),
  comments: owned(array({ body: text().notNull() })),
});

function objOf(opts: Parameters<typeof compileFind<typeof post>>[1]) {
  return compileFind(post, opts).text.split("\n")[0]!.replace(/^SELECT /, "").replace(/ AS data$/, "");
}

describe("select projection", () => {
  it("emits only id + selected columns (no timestamps)", () => {
    expect(objOf({ select: { title: true } })).toBe(
      "json_build_object('id', posts.id, 'title', posts.title)",
    );
  });

  it("can opt timestamps back in", () => {
    expect(objOf({ select: { title: true, createdAt: true } })).toBe(
      "json_build_object('id', posts.id, 'title', posts.title, 'createdAt', posts.created_at)",
    );
  });

  it("prunes an owned child to selected sub-fields", () => {
    expect(objOf({ select: { comments: { body: true } } })).toBe(
      "json_build_object('id', posts.id, 'comments', (SELECT coalesce(json_agg(" +
        "json_build_object('id', posts__comments.id, 'body', posts__comments.body) " +
        "ORDER BY posts__comments.created_at), '[]'::json) " +
        "FROM posts__comments WHERE posts__comments.posts_id = posts.id))",
    );
  });

  it("select on a reference brings the pruned target (no FK unless selected)", () => {
    expect(objOf({ select: { author: { name: true } } })).toBe(
      "json_build_object('id', posts.id, 'author', (SELECT json_build_object(" +
        "'id', authors.id, 'name', authors.name) FROM authors WHERE authors.id = posts.author_id LIMIT 1))",
    );
  });

  it("can select the raw FK via <field>Id", () => {
    expect(objOf({ select: { authorId: true } })).toBe(
      "json_build_object('id', posts.id, 'authorId', posts.author_id)",
    );
  });

  it("select: true on owned brings the full child", () => {
    expect(objOf({ select: { comments: true } })).toContain(
      "json_build_object('id', posts__comments.id, 'body', posts__comments.body, " +
        "'createdAt', posts__comments.created_at, 'updatedAt', posts__comments.updated_at)",
    );
  });
});
