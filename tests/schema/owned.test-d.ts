import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  int4,
  owned,
  text,
  type InferEntity,
} from "../../app/engine/index.js";

describe("owned inference", () => {
  const user = defineEntity("users", {
    name: text().notNull(),
    profile: owned({ bio: text() }),
    addresses: owned(
      array({
        street: text().notNull(),
        landmarks: owned(array({ label: text().notNull() })),
      }),
    ),
  });

  it("nests 1:1 owned as an object and 1:N as an array, recursively", () => {
    expectTypeOf<InferEntity<typeof user>>().toEqualTypeOf<{
      id: string;
      name: string;
      profile: {
        id: string;
        bio: string | null;
        createdAt: Date;
        updatedAt: Date;
      };
      addresses: Array<{
        id: string;
        street: string;
        landmarks: Array<{
          id: string;
          label: string;
          createdAt: Date;
          updatedAt: Date;
        }>;
        createdAt: Date;
        updatedAt: Date;
      }>;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });

  it("owned sub-entities carry their own id/timestamps", () => {
    type U = InferEntity<typeof user>;
    expectTypeOf<U["profile"]["id"]>().toEqualTypeOf<string>();
    expectTypeOf<U["addresses"][number]["createdAt"]>().toEqualTypeOf<Date>();
  });
});
