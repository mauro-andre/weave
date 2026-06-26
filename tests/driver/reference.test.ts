import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { defineEntity, reference, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = DATABASE_URL;

const city = defineEntity("weave_ref_cities", { name: text().notNull() });
const user = defineEntity("weave_ref_users", {
  name: text().notNull(),
  city: reference(city),
});

const tables = `weave_ref_users, weave_ref_cities`;

describe.skipIf(noDb)("reference (association)", () => {
  let db: Weave;
  let cityId: string;

  beforeAll(async () => {
    db = weave({ url, entities: { city, user } });
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.sync();
    const saved = await db.save(city, { name: "Recife" });
    cityId = saved.id;
  });

  afterAll(async () => {
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.close();
  });

  it("saves via cityId and reads cityId by default (no target)", async () => {
    const saved = await db.save(user, { name: "Mauro", cityId });
    expect(saved.cityId).toBe(cityId);
    expect((saved as Record<string, unknown>)["city"]).toBeUndefined();
  });

  it("brings the target only when expanded", async () => {
    const [u] = await db.find(user, { where: { name: "Mauro" }, expand: { city: true } });
    expect(u!.cityId).toBe(cityId);
    expect(u!.city?.name).toBe("Recife");
    expect(u!.city?.createdAt).toBeInstanceOf(Date);
  });

  it("ignores a stowaway target object on write; never touches the target table", async () => {
    const [u] = await db.find(user, { where: { name: "Mauro" }, expand: { city: true } });
    // Round-trip: mutate a non-reference field, keep the expanded city object.
    const updated = await db.save(user, {
      id: u!.id,
      name: "Mauro Updated",
      cityId: u!.cityId!,
      // a stowaway `city` object is tolerated and ignored (excess prop on a variable)
      ...({ city: { ...u!.city, name: "HACKED" } } as object),
    });
    expect(updated.name).toBe("Mauro Updated");

    // The cities table is untouched.
    const [c] = await db.sql<{ name: string }[]>`
      select name from weave_ref_cities where id = ${cityId}`;
    expect(c!.name).toBe("Recife");
  });
});
