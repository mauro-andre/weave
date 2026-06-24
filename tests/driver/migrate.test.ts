import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { defineEntity, int4, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

// v1 of the entity.
const userV1 = defineEntity("weave_mig_users", { name: text().notNull() });
// v2 adds a column and an index — the evolution case.
const userV2 = defineEntity("weave_mig_users", {
  name: text().notNull(),
  age: int4().index(),
});

describe.skipIf(noDb)("sync diff / generate (integration)", () => {
  let db1: Weave;

  beforeAll(async () => {
    db1 = weave({ url, entities: { user: userV1 } });
    await db1.sql`drop table if exists weave_mig_users cascade`;
    await db1.sync();
    await db1.save(userV1, { name: "Mauro" });
  });

  afterAll(async () => {
    await db1.sql`drop table if exists weave_mig_users cascade`;
    await db1.close();
  });

  it("sync() adds the new column and index on the existing table", async () => {
    const db2 = weave({ url, entities: { user: userV2 } });
    const result = await db2.sync();
    expect(result.created).toEqual([]); // table already existed
    expect(result.columnsAdded).toEqual(["weave_mig_users.age"]);
    expect(result.indexesAdded).toEqual(["weave_mig_users_age_idx"]);

    // The existing row survived; new column is nullable so it's null.
    const [u] = await db2.find(userV2, { where: { name: "Mauro" } });
    expect(u!.name).toBe("Mauro");
    expect(u!.age).toBeNull();
    await db2.close();
  });

  it("generate() emits the additive SQL without applying (idempotent after sync)", async () => {
    const db2 = weave({ url, entities: { user: userV2 } });
    const { sql, warnings } = await db2.generate();
    expect(sql).toBe(""); // already synced — nothing to do
    expect(warnings).toEqual([]);
    await db2.close();
  });

  it("generate() reports drift for a column missing from the shape", async () => {
    // userV1 lacks `age` (now in the DB) → drift warning, no drop.
    const dbStale = weave({ url, entities: { user: userV1 } });
    const { warnings } = await dbStale.generate();
    expect(warnings.some((w) => w.includes("age") && w.includes("not dropped"))).toBe(true);
    await dbStale.close();
  });
});
