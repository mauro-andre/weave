import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { array, defineEntity, owned, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = DATABASE_URL;

const user = defineEntity("weave_save_users", {
  name: text().notNull(),
  email: text().notNull(),
  tags: array(text()),
  addresses: owned(
    array({
      street: text().notNull(),
      landmarks: owned(array({ label: text().notNull() })),
    }),
  ),
});

const tables = `
  weave_save_user__addresses__landmarks,
  weave_save_user__addresses,
  weave_save_users`;

describe.skipIf(noDb)("save (shred)", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { user } });
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.sync();
  });

  afterAll(async () => {
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.close();
  });

  it("inserts a new aggregate and returns the nested tree", async () => {
    const saved = await db.save(user, {
      name: "Mauro",
      email: "m@x.com",
      addresses: [
        { street: "Rua X", landmarks: [{ label: "Esquina" }] },
        { street: "Rua Y", landmarks: [] },
      ],
    });

    expect(typeof saved.id).toBe("string");
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.tags).toEqual([]); // array default applied
    expect(saved.addresses).toHaveLength(2);
    const ruaX = saved.addresses.find((a) => a.street === "Rua X")!;
    expect(ruaX.landmarks[0]!.label).toBe("Esquina");
  });

  it("upserts by id and replaces the owned subtree", async () => {
    const first = await db.save(user, {
      name: "Ana",
      email: "ana@x.com",
      addresses: [{ street: "Old", landmarks: [{ label: "L1" }] }],
    });

    const updated = await db.save(user, {
      id: first.id,
      name: "Ana Updated",
      email: "ana@x.com",
      addresses: [{ street: "New", landmarks: [] }],
    });

    expect(updated.id).toBe(first.id); // same root row
    expect(updated.name).toBe("Ana Updated");
    expect(updated.addresses).toHaveLength(1);
    expect(updated.addresses[0]!.street).toBe("New");

    // Old children are gone (replace), including grandchildren.
    const landmarks = await db.sql`select count(*)::int as n from weave_save_user__addresses__landmarks
      where label = 'L1'`;
    expect(landmarks[0]!.n).toBe(0);
  });

  it("omitting an owned collection clears it", async () => {
    const saved = await db.save(user, {
      name: "Bo",
      email: "bo@x.com",
      addresses: [{ street: "S", landmarks: [] }],
    });
    const cleared = await db.save(user, { id: saved.id, name: "Bo", email: "bo@x.com" });
    expect(cleared.addresses).toEqual([]);
  });
});
