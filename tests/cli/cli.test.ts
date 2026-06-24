import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { parseArgs, runCommand } from "../../app/engine/cli.js";
import { defineEntity, int4, text, weave, type Weave } from "../../app/engine/index.js";

describe("parseArgs", () => {
  it("parses a command with --flag value and --flag=value", () => {
    expect(parseArgs(["generate", "--out", "m.sql"])).toEqual({
      command: "generate",
      flags: { out: "m.sql" },
    });
    expect(parseArgs(["status", "--config=weave.config.mjs"])).toEqual({
      command: "status",
      flags: { config: "weave.config.mjs" },
    });
  });

  it("defaults to help with no args", () => {
    expect(parseArgs([])).toEqual({ command: "help", flags: {} });
  });
});

const noDb = process.env.WEAVE_NO_DB === "1";
const url = process.env.DATABASE_URL ?? "postgres://weave:weave@localhost:5432/weave";

const userV1 = defineEntity("weave_cli_users", { name: text().notNull() });
const userV2 = defineEntity("weave_cli_users", { name: text().notNull(), age: int4() });

describe.skipIf(noDb)("runCommand (integration)", () => {
  let db: Weave;
  const lines: string[] = [];
  const out = (l: string) => lines.push(l);

  beforeAll(async () => {
    db = weave({ url, entities: { user: userV1 } });
    await db.sql`drop table if exists weave_cli_users cascade`;
    await db.sync();
  });

  afterAll(async () => {
    await db.sql`drop table if exists weave_cli_users cascade`;
    await db.close();
  });

  it("status reports pending changes for an evolved shape", async () => {
    const db2 = weave({ url, entities: { user: userV2 } });
    lines.length = 0;
    const code = await runCommand(db2, "status", {}, out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("add column weave_cli_users.age");
    await db2.close();
  });

  it("sync applies the change; a second status is up to date", async () => {
    const db2 = weave({ url, entities: { user: userV2 } });
    lines.length = 0;
    await runCommand(db2, "sync", {}, out);
    expect(lines.join("\n")).toContain("added column weave_cli_users.age");

    lines.length = 0;
    await runCommand(db2, "status", {}, out);
    expect(lines.join("\n")).toBe("Schema is up to date.");
    await db2.close();
  });

  it("unknown command prints usage and returns code 1", async () => {
    lines.length = 0;
    const code = await runCommand(db, "frobnicate", {}, out);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Usage: weave");
  });
});
