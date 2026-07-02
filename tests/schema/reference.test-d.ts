import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  owned,
  reference,
  text,
  type InferEntity,
  type InferInsert,
  type InferRead,
} from "../../app/engine/index.js";

const city = defineEntity("cities", { name: text().notNull() });

const user = defineEntity("users", {
  name: text().notNull(),
  city: reference(city), // nullable
  homeCity: reference(city).notNull(), // required
});

describe("reference read inference", () => {
  it("exposes <field>Id always, target only via expand", () => {
    expectTypeOf<InferEntity<typeof user>>().toEqualTypeOf<{
      id: string;
      name: string;
      cityId: string | null;
      homeCityId: string;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });

  it("adds the expanded object (nullable mirrors the FK) when expanded", () => {
    type R = InferRead<typeof user, { city: true }>;
    expectTypeOf<R["cityId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<R["city"]>().toEqualTypeOf<
      { id: string; name: string; createdAt: Date; updatedAt: Date } | null
    >();
  });
});

describe("reference insert inference", () => {
  it("sets references via <field>Id; notNull → required", () => {
    expectTypeOf<InferInsert<typeof user>>().toEqualTypeOf<{
      id?: string;
      name: string;
      homeCityId: string; // required (notNull)
      cityId?: string | null; // optional + nullable — pode setar null pra limpar a ref
    }>();
  });

  it("never accepts the target object on write", () => {
    // @ts-expect-error — passing the city object is not allowed; use cityId.
    const _bad: InferInsert<typeof user> = { name: "x", homeCityId: "1", city: { name: "y" } };
    void _bad;
  });
});
