import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  owned,
  reference,
  text,
  type InferSelect,
} from "../../app/engine/index.js";

const author = defineEntity("authors", { name: text().notNull(), email: text().notNull() });
const post = defineEntity("posts", {
  title: text().notNull(),
  body: text().notNull(),
  author: reference(author),
  comments: owned(array({ body: text().notNull() })),
});

describe("InferSelect prunes the type", () => {
  it("only id + selected fields", () => {
    expectTypeOf<InferSelect<typeof post, { title: true }>>().toEqualTypeOf<{
      id: string;
      title: string;
    }>();
  });

  it("nested owned + reference selection", () => {
    type R = InferSelect<
      typeof post,
      { title: true; author: { name: true }; comments: { body: true } }
    >;
    expectTypeOf<R>().toEqualTypeOf<{
      id: string;
      title: string;
      author: { id: string; name: string } | null;
      comments: { id: string; body: string }[];
    }>();
  });

  it("select: true brings the full sub-entity", () => {
    type R = InferSelect<typeof post, { author: true }>;
    expectTypeOf<R["author"]>().toEqualTypeOf<
      { id: string; name: string; email: string; createdAt: Date; updatedAt: Date } | null
    >();
  });

  it("a non-selected field is absent from the type", () => {
    type R = InferSelect<typeof post, { title: true }>;
    // @ts-expect-error — body was not selected
    type _ = R["body"];
  });
});
