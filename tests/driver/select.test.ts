import { DATABASE_URL } from "../global-setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { array, defineEntity, owned, reference, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = DATABASE_URL;

const author = defineEntity("weave_sel_authors", { name: text().notNull(), email: text().notNull() });
const post = defineEntity("weave_sel_posts", {
  title: text().notNull(),
  body: text().notNull(),
  author: reference(author),
  comments: owned(array({ body: text().notNull() })),
});

const tables = `weave_sel_post__comments, weave_sel_posts, weave_sel_authors`;

describe.skipIf(noDb)("select (integration)", () => {
  let db: Weave;

  beforeAll(async () => {
    db = weave({ url, entities: { author, post } });
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.sync();
    const a = await db.save(author, { name: "Mauro", email: "m@x.com" });
    await db.save(post, {
      title: "Hello",
      body: "secret body",
      authorId: a.id,
      comments: [{ body: "c1" }],
    });
  });

  afterAll(async () => {
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.close();
  });

  it("returns only id + selected fields", async () => {
    const [p] = await db.find(post, { where: { title: "Hello" }, select: { title: true } });
    expect(p).toEqual({ id: expect.any(String), title: "Hello" });
    expect("body" in p!).toBe(false);
    expect("createdAt" in p!).toBe(false);
  });

  it("prunes nested owned + reference", async () => {
    const [p] = await db.find(post, {
      where: { title: "Hello" },
      select: { title: true, author: { name: true }, comments: { body: true } },
    });
    expect(p!.title).toBe("Hello");
    expect(p!.author).toEqual({ id: expect.any(String), name: "Mauro" });
    expect("email" in (p!.author as object)).toBe(false);
    expect(p!.comments).toEqual([{ id: expect.any(String), body: "c1" }]);
  });

  it("paginate honors select in docs", async () => {
    const page = await db.paginate(post, { select: { title: true }, perPage: 10 });
    expect(page.docsQuantity).toBe(1);
    expect(page.docs[0]).toEqual({ id: expect.any(String), title: "Hello" });
  });
});
