import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  int4,
  owned,
  text,
  type InferInsert,
} from "../../src/index.js";

describe("InferInsert", () => {
  const user = defineEntity("users", {
    name: text().notNull(), // required
    email: text().notNull(), // required
    age: int4().notNull().default(0), // optional (has default)
    bio: text(), // optional (nullable)
    tags: array(text()), // optional (array default '{}')
    addresses: owned(array({ street: text().notNull() })), // optional (owned)
  });

  it("marks notNull-without-default as required, the rest optional", () => {
    expectTypeOf<InferInsert<typeof user>>().toEqualTypeOf<{
      id?: string;
      name: string;
      email: string;
      age?: number;
      bio?: string | null;
      tags?: string[];
      addresses?: Array<{ id?: string; street: string }>;
    }>();
  });

  it("nests owned insert types with optional id and no timestamps", () => {
    type Addr = NonNullable<InferInsert<typeof user>["addresses"]>[number];
    expectTypeOf<Addr>().toEqualTypeOf<{ id?: string; street: string }>();
  });
});
