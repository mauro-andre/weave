import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  owned,
  reference,
  text,
  type WhereInput,
} from "../../app/engine/index.js";

const tag = defineEntity("tags", { label: text().notNull() });
const author = defineEntity("authors", { name: text().notNull() });
const post = defineEntity("posts", {
  title: text().notNull(),
  keywords: array(text()),
  author: reference(author),
  tags: reference(array(tag)),
  comments: owned(array({ body: text().notNull() })),
});

type W = WhereInput<typeof post>;

describe("nested filter typing", () => {
  it("accepts array, nested ref, FK id, and quantifiers", () => {
    expectTypeOf<{
      keywords: { has: string };
      author: { name: { ilike: string } };
      authorId: string;
      tags: { some: { label: string } };
      comments: { every: { body: string } };
    }>().toMatchTypeOf<W>();
  });

  it("rejects an unknown field", () => {
    // @ts-expect-error — 'nope' is not a field of post
    const _bad: W = { nope: 1 };
    void _bad;
  });
});
