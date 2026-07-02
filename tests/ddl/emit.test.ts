import { describe, it, expect } from "vitest";
import {
  array,
  bool,
  defineEntity,
  emitCreateTable,
  emitEntity,
  emitIndexes,
  int4,
  owned,
  reference,
  text,
  timestamptz,
  timeBucket,
} from "../../app/engine/index.js";

describe("emitCreateTable", () => {
  it("emits the canonical scalar + array table", () => {
    const user = defineEntity("users", {
      name: text().notNull(),
      email: text().notNull().unique(),
      bio: text(),
      age: int4().notNull().default(0),
      active: bool().notNull().default(true),
      phones: array(text()),
      lastSeen: timestamptz(),
    });

    expect(emitCreateTable(user)).toBe(
      [
        "CREATE TABLE users (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  name text NOT NULL,",
        "  email text NOT NULL UNIQUE,",
        "  bio text,",
        "  age integer NOT NULL DEFAULT 0,",
        "  active boolean NOT NULL DEFAULT true,",
        "  phones text[] NOT NULL DEFAULT '{}',",
        "  last_seen timestamp with time zone,",
        "  created_at timestamp with time zone NOT NULL DEFAULT now(),",
        "  updated_at timestamp with time zone NOT NULL DEFAULT now()",
        ");",
      ].join("\n"),
    );
  });

  it("escapes single quotes in string defaults", () => {
    const t = defineEntity("notes", { label: text().notNull().default("a'b") });
    expect(emitCreateTable(t)).toContain("label text NOT NULL DEFAULT 'a''b'");
  });
});

describe("emitIndexes", () => {
  it("emits one CREATE INDEX per .index() column", () => {
    const user = defineEntity("users", {
      username: text().notNull().index(),
      bio: text(),
      slug: text().index(),
    });
    expect(emitIndexes(user)).toEqual([
      "CREATE INDEX users_username_idx ON users (username);",
      "CREATE INDEX users_slug_idx ON users (slug);",
    ]);
  });

  it("returns nothing when no column is indexed", () => {
    const t = defineEntity("plain", { a: text() });
    expect(emitIndexes(t)).toEqual([]);
  });
});

describe("emitEntity", () => {
  it("joins the table and its indexes", () => {
    const t = defineEntity("users", { username: text().notNull().index() });
    const out = emitEntity(t);
    expect(out).toContain("CREATE TABLE users (");
    expect(out.trimEnd().endsWith("CREATE INDEX users_username_idx ON users (username);")).toBe(true);
  });
});

describe("composite unique / index (entity-level)", () => {
  it("emits CREATE [UNIQUE] INDEX with resolved columns (reference → <field>_id)", () => {
    const stack = defineEntity("stacks", { name: text().notNull() });
    const reg = defineEntity(
      "regs",
      {
        slugName: text().notNull(),
        stack: reference(stack),
        host: text().notNull(),
      },
      { unique: [["slugName", "stack"]], index: [["host", "slugName"]] },
    );
    const out = emitEntity(reg);
    // reference `stack` resolve pra coluna FK `stack_id`; nomes determinísticos.
    expect(out).toContain("CREATE UNIQUE INDEX regs_slug_name_stack_id_key ON regs (slug_name, stack_id);");
    expect(out).toContain("CREATE INDEX regs_host_slug_name_idx ON regs (host, slug_name);");
  });

  it("defineEntity rejects an unknown / duplicate / empty / owned group member", () => {
    expect(() => defineEntity("x", { a: text() }, { unique: [["nope"]] })).toThrow(/unknown field/);
    expect(() => defineEntity("x", { a: text() }, { unique: [["a", "a"]] })).toThrow(/duplicate/);
    expect(() => defineEntity("x", { a: text() }, { unique: [[]] })).toThrow(/non-empty/);
    expect(() =>
      defineEntity("x", { a: text(), kids: owned({ n: text() }) }, { index: [["a", "kids"]] }),
    ).toThrow(/owned/);
  });
});

describe("duplicate-column guard (scalar *Id vs link column)", () => {
  it("owned-array com scalar terminando em Id agora funciona (FK plural não colide com o singular)", () => {
    // O FK do child de `dbPresets` é `presets_id` (plural, de lastSegment) — NÃO colide
    // com o scalar `presetId` → `preset_id`. O caso do PodCubo passou a materializar.
    const e = defineEntity("dbPresets", {
      presets: owned(array({ presetId: text().notNull(), name: text().notNull() })),
    });
    expect(() => emitEntity(e)).not.toThrow();
  });

  it("owned-array cujo scalar bate no FK plural do child → aí sim erro claro", () => {
    // child de `orders` ganha `orders_id`; um scalar `ordersId` → `orders_id` colide.
    const e = defineEntity("orders", {
      items: owned(array({ ordersId: text().notNull(), sku: text().notNull() })),
    });
    expect(() => emitEntity(e)).toThrow(/duplicate column 'orders_id'/);
  });

  it("reference + scalar homônimo (fooId) → mesmo guard", () => {
    const target = defineEntity("targets", { name: text().notNull() });
    const e = defineEntity("things", { foo: reference(target), fooId: text() });
    expect(() => emitEntity(e)).toThrow(/duplicate column 'foo_id'/);
  });

  it("scalar *Id sem link homônimo passa (caso normal de entity raiz)", () => {
    const e = defineEntity("dns", { zoneId: text().notNull(), accountId: text().notNull() });
    expect(() => emitEntity(e)).not.toThrow();
  });
});

describe("emitCreateTable — partição por tempo", () => {
  it("particiona por RANGE (ts) e move a PK pra (id, ts)", () => {
    const req = defineEntity(
      "app_request",
      { host: text().notNull(), ts: timestamptz().notNull(), status: int4().notNull() },
      { partitionBy: timeBucket("ts", "1d"), retention: "30d" },
    );
    const sql = emitCreateTable(req);
    // id perde o PRIMARY KEY inline (a PK vira composta com a coluna de partição).
    expect(sql).toContain("  id uuid NOT NULL DEFAULT gen_random_uuid(),");
    expect(sql).not.toContain("id uuid PRIMARY KEY");
    expect(sql).toContain("  PRIMARY KEY (id, ts)");
    // o sufixo PARTITION BY fica FORA dos parênteses das colunas, antes do `;`.
    expect(sql.trimEnd()).toMatch(/\) PARTITION BY RANGE \(ts\);$/);
  });
});
