import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { defineEntity, int4, projection, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

const employee = defineEntity("weave_proj_employees", {
  name: text().notNull(),
  email: text().notNull(),
  salary: int4(),
});

// Named, reusable, per-role views.
const publicEmployee = projection(employee, { name: true });
const hrEmployee = projection(employee, { name: true, email: true, salary: true });

describe.skipIf(noDb)("named projections (integration)", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { employee } });
    await db.sql`drop table if exists weave_proj_employees cascade`;
    await db.sync();
    await db.save(employee, { name: "Mauro", email: "m@x.com", salary: 9000 });
  });

  afterAll(async () => {
    await db.sql`drop table if exists weave_proj_employees cascade`;
    await db.close();
  });

  it("publicEmployee hides salary/email", async () => {
    const [e] = await db.find(publicEmployee);
    expect(e).toEqual({ id: expect.any(String), name: "Mauro" });
    expect("salary" in e!).toBe(false);
    expect("email" in e!).toBe(false);
  });

  it("hrEmployee exposes the full set", async () => {
    const [e] = await db.find(hrEmployee, { where: { name: "Mauro" } });
    expect(e!.name).toBe("Mauro");
    expect(e!.email).toBe("m@x.com");
    expect(e!.salary).toBe(9000);
  });

  it("role decides the view; where still types against the entity", async () => {
    for (const isHR of [false, true]) {
      const view = isHR ? hrEmployee : publicEmployee;
      const [e] = await db.find(view, { where: { email: "m@x.com" } });
      expect(e!.name).toBe("Mauro");
    }
  });

  it("paginate works through a projection", async () => {
    const page = await db.paginate(publicEmployee, { perPage: 10 });
    expect(page.docsQuantity).toBe(1);
    expect(page.docs[0]).toEqual({ id: expect.any(String), name: "Mauro" });
  });
});
