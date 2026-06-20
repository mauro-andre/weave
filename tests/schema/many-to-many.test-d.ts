import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  reference,
  text,
  type InferEntity,
  type InferInsert,
  type InferRead,
} from "../../src/index.js";

const tag = defineEntity("tags", { label: text().notNull() });
const post = defineEntity("posts", {
  title: text().notNull(),
  tags: reference(array(tag)),
});

describe("N:N inference", () => {
  it("brings nothing by default (no ids field)", () => {
    expectTypeOf<InferEntity<typeof post>>().toEqualTypeOf<{
      id: string;
      title: string;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });

  it("exposes an array of targets when expanded", () => {
    type R = InferRead<typeof post, { tags: true }>;
    expectTypeOf<R["tags"]>().toEqualTypeOf<
      Array<{ id: string; label: string; createdAt: Date; updatedAt: Date }>
    >();
  });

  it("writes the link set via <field>Ids (optional)", () => {
    expectTypeOf<InferInsert<typeof post>>().toEqualTypeOf<{
      id?: string;
      title: string;
      tagsIds?: string[];
    }>();
  });
});

describe("nested reference expand (depth-capped recursion)", () => {
  const country = defineEntity("countries", { name: text().notNull() });
  const city = defineEntity("cities", { name: text().notNull(), country: reference(country) });
  const person = defineEntity("people", { name: text().notNull(), city: reference(city) });

  it("expands a reference chain to the requested depth", () => {
    type R = InferRead<typeof person, { city: { country: true } }>;
    expectTypeOf<R["city"]>().toEqualTypeOf<{
      id: string;
      name: string;
      countryId: string | null;
      country: { id: string; name: string; createdAt: Date; updatedAt: Date } | null;
      createdAt: Date;
      updatedAt: Date;
    } | null>();
  });
});
