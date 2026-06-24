import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { array, defineEntity, reference, text, weave, type Weave } from "../../app/engine/index.js";

const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

const tag = defineEntity("weave_nn_tags", { label: text().notNull() });
const post = defineEntity("weave_nn_posts", {
  title: text().notNull(),
  tags: reference(array(tag)),
});

const tables = `weave_nn_post__tags, weave_nn_posts, weave_nn_tags`;

describe.skipIf(noDb)("N:N (reference array)", () => {
  let db: Weave;
  let ta: string;
  let tb: string;

  beforeAll(async () => {
    // Register post BEFORE tag to prove topological ordering in sync().
    db = weave({ url, entities: { post, tag } });
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.sync();
    ta = (await db.save(tag, { label: "ts" })).id;
    tb = (await db.save(tag, { label: "sql" })).id;
  });

  afterAll(async () => {
    await db.sql.unsafe(`drop table if exists ${tables} cascade`);
    await db.close();
  });

  it("sync() created the join table despite registration order", async () => {
    const rows = await db.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'weave_nn_post__tags'`;
    expect(rows).toHaveLength(1);
  });

  it("writes the link set via tagsIds and reads nothing by default", async () => {
    const saved = await db.save(post, { title: "Hello", tagsIds: [ta, tb] });
    expect((saved as Record<string, unknown>)["tags"]).toBeUndefined();

    const linkCount = await db.sql<{ n: number }[]>`
      select count(*)::int as n from weave_nn_post__tags`;
    expect(linkCount[0]!.n).toBe(2);
  });

  it("aggregates linked targets on expand", async () => {
    const [p] = await db.find(post, { where: { title: "Hello" }, expand: { tags: true } });
    expect(p!.tags.map((t) => t.label).sort()).toEqual(["sql", "ts"]);
    expect(p!.tags[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("replaces the link set on re-save", async () => {
    const [p] = await db.find(post, { where: { title: "Hello" } });
    await db.save(post, { id: p!.id, title: "Hello", tagsIds: [ta] });
    const [again] = await db.find(post, { where: { title: "Hello" }, expand: { tags: true } });
    expect(again!.tags.map((t) => t.label)).toEqual(["ts"]);
  });

  it("deleting a tag cascades the link, not the post", async () => {
    await db.sql`delete from weave_nn_tags where id = ${ta}`;
    const [p] = await db.find(post, { where: { title: "Hello" }, expand: { tags: true } });
    expect(p).toBeDefined(); // post survives
    expect(p!.tags).toEqual([]); // link gone
  });
});
