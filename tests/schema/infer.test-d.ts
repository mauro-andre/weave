import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  int4,
  int8,
  text,
  timestamptz,
  type InferColumn,
  type InferEntity,
} from "../../app/engine/index.js";

describe("column inference", () => {
  it("nullable by default, notNull narrows", () => {
    expectTypeOf<InferColumn<ReturnType<typeof text>>>().toEqualTypeOf<string | null>();
    expectTypeOf<
      InferColumn<ReturnType<typeof text>["notNull"] extends () => infer R ? R : never>
    >().toEqualTypeOf<string>();
  });

  it("array is string[] (never null by default)", () => {
    const phones = array(text());
    expectTypeOf<InferColumn<typeof phones>>().toEqualTypeOf<string[]>();
  });

  it("array().nullable() widens to string[] | null", () => {
    const tags = array(text()).nullable();
    expectTypeOf<InferColumn<typeof tags>>().toEqualTypeOf<string[] | null>();
  });

  it("carries the element TS type", () => {
    expectTypeOf<InferColumn<ReturnType<typeof int8>>>().toEqualTypeOf<bigint | null>();
  });
});

describe("entity inference", () => {
  const user = defineEntity("users", {
    name: text().notNull(),
    bio: text(),
    age: int4().notNull(),
    phones: array(text()),
    lastSeen: timestamptz(),
  });

  it("produces system columns + user shape with correct nullability", () => {
    expectTypeOf<InferEntity<typeof user>>().toEqualTypeOf<{
      id: string;
      name: string;
      bio: string | null;
      age: number;
      phones: string[];
      lastSeen: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });
});
