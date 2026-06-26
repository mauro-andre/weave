import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { array, defineEntity, owned, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = DATABASE_URL;

const user = defineEntity("weave_find_users", {
  name: text().notNull(),
  email: text().notNull(),
  addresses: owned(
    array({
      street: text().notNull(),
      landmarks: owned(array({ label: text().notNull() })),
    }),
  ),
});

describe.skipIf(noDb)("find (weave read)", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { user } });
    await db.sql`drop table if exists
      weave_find_user__addresses__landmarks,
      weave_find_user__addresses,
      weave_find_users cascade`;
    await db.sync();

    // Seed one user with a nested owned tree.
    await db.transaction(async (tx) => {
      const [u] = await tx<{ id: string }[]>`
        insert into weave_find_users (name, email)
        values ('Mauro', 'm@x.com') returning id`;
      const [a] = await tx<{ id: string }[]>`
        insert into weave_find_user__addresses (user_id, street)
        values (${u!.id}, 'Rua X') returning id`;
      await tx`insert into weave_find_user__addresses__landmarks (address_id, label)
        values (${a!.id}, 'Esquina')`;
    });
  });

  afterAll(async () => {
    await db.sql`drop table if exists
      weave_find_user__addresses__landmarks,
      weave_find_user__addresses,
      weave_find_users cascade`;
    await db.close();
  });

  it("returns the owned tree nested automatically", async () => {
    const users = await db.find(user, { where: { email: "m@x.com" } });
    expect(users).toHaveLength(1);

    const u = users[0]!;
    expect(u.name).toBe("Mauro");
    expect(typeof u.id).toBe("string");
    expect(u.createdAt).toBeInstanceOf(Date);

    expect(u.addresses).toHaveLength(1);
    expect(u.addresses[0]!.street).toBe("Rua X");
    expect(u.addresses[0]!.createdAt).toBeInstanceOf(Date);

    expect(u.addresses[0]!.landmarks).toHaveLength(1);
    expect(u.addresses[0]!.landmarks[0]!.label).toBe("Esquina");
  });

  it("returns [] when the filter matches nothing", async () => {
    const users = await db.find(user, { where: { email: "nobody@x.com" } });
    expect(users).toEqual([]);
  });
});
