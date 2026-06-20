import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { array, defineEntity, owned, reference, text, weave, type Weave } from "../../src/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

const tag = defineEntity("weave_nf_tags", { label: text().notNull() });
const post = defineEntity("weave_nf_posts", {
  title: text().notNull(),
  keywords: array(text()),
  tags: reference(array(tag)),
  comments: owned(array({ body: text().notNull(), approved: text() })),
});

const tables = `weave_nf_post_tags, weave_nf_post_comments, weave_nf_posts, weave_nf_tags`;

describe.skipIf(noDb)("nested filtering (integration)", () => {
  let db: Weave;
  let sql: string, ts: string;

  beforeAll(async () => {
    db = weave({ url, entities: { tag, post } });
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.sync();
    sql = (await db.save(tag, { label: "sql" })).id;
    ts = (await db.save(tag, { label: "ts" })).id;

    await db.save(post, {
      title: "A",
      keywords: ["postgres", "weave"],
      tagsIds: [sql],
      comments: [{ body: "nice", approved: "yes" }],
    });
    await db.save(post, {
      title: "B",
      keywords: ["typescript"],
      tagsIds: [ts],
      comments: [{ body: "meh", approved: "no" }],
    });
  });

  afterAll(async () => {
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.close();
  });

  const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

  it("array column: has", async () => {
    const rows = await db.find(post, { where: { keywords: { has: "postgres" } } });
    expect(titles(rows)).toEqual(["A"]);
  });

  it("N:N some: post linked to the sql tag", async () => {
    const rows = await db.find(post, { where: { tags: { some: { label: "sql" } } } });
    expect(titles(rows)).toEqual(["A"]);
  });

  it("owned some: post with an unapproved comment", async () => {
    const rows = await db.find(post, { where: { comments: { some: { approved: "no" } } } });
    expect(titles(rows)).toEqual(["B"]);
  });

  it("owned every: post where all comments approved", async () => {
    const rows = await db.find(post, { where: { comments: { every: { approved: "yes" } } } });
    expect(titles(rows)).toEqual(["A"]);
  });

  it("composed: keyword has OR linked-to-ts", async () => {
    const rows = await db.find(post, {
      where: { or: [{ keywords: { has: "postgres" } }, { tags: { some: { label: "ts" } } }] },
    });
    expect(titles(rows)).toEqual(["A", "B"]);
  });
});
