import { describe, it, expectTypeOf } from "vitest";
import { defineEntity, int4, projection, text } from "../../src/index.js";
import { Weave } from "../../src/index.js";

const employee = defineEntity("employees", {
  name: text().notNull(),
  email: text().notNull(),
  salary: int4(),
});

const publicEmployee = projection(employee, { name: true });

describe("projection result typing", () => {
  it("find through a projection returns the pruned type", async () => {
    const db = {} as Weave;
    const rows = await db.find(publicEmployee);
    expectTypeOf<(typeof rows)[number]>().toEqualTypeOf<{ id: string; name: string }>();
  });

  it("the hidden field is a compile error (permission boundary)", async () => {
    const db = {} as Weave;
    const [e] = await db.find(publicEmployee);
    // @ts-expect-error — salary was not in the projection
    e?.salary;
  });
});
