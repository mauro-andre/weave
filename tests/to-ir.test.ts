import { describe, expect, it } from "vitest";
import { toIR, fromIR, type EntityIR } from "@mauroandre/weave-core";
import { defineEntity, text, int4, owned, mirror, reference, array } from "../app/engine/index.js";

// `toIR` é o caminho de IDA (Entity → IR), inverso do `fromIR`. Testes puros, sem
// banco. Duas direções: (1) round-trip IR→fromIR→toIR reproduz o IR canônico;
// (2) toIR(defineEntity(...)) produz o IR esperado a partir do builder real.

// IRs canônicos (mínimos: sem optionals falsos), cobrindo coluna notNull/unique,
// nullable, default, reference N:1 e N:N, e owned 1:N com reference dentro.
const categoryIR: EntityIR = {
  irVersion: 1,
  name: "category",
  fields: { name: { kind: "column", type: "text", notNull: true, unique: true } },
};
const productIR: EntityIR = {
  irVersion: 1,
  name: "product",
  fields: {
    name: { kind: "column", type: "text", notNull: true },
    price: { kind: "column", type: "int4", notNull: true },
    description: { kind: "column", type: "text" },
    status: { kind: "column", type: "text", default: "draft" },
    category: { kind: "reference", target: "category", cardinality: "one" },
    tags: { kind: "reference", target: "category", cardinality: "many" },
  },
};
const orderIR: EntityIR = {
  irVersion: 1,
  name: "order",
  fields: {
    code: { kind: "column", type: "text", notNull: true },
    items: {
      kind: "owned",
      array: true,
      shape: {
        sku: { kind: "column", type: "text", notNull: true },
        quantity: { kind: "column", type: "int4", notNull: true },
        category: { kind: "reference", target: "category", cardinality: "one" },
      },
    },
  },
};

describe("toIR — round-trip IR → fromIR → toIR", () => {
  const entities = fromIR([categoryIR, productIR, orderIR]);

  it("reproduz uma coluna notNull + unique", () => {
    expect(toIR(entities["category"]!)).toEqual(categoryIR);
  });

  it("reproduz colunas (nullable/default), reference N:1 e N:N", () => {
    expect(toIR(entities["product"]!)).toEqual(productIR);
  });

  it("reproduz owned 1:N com reference aninhada dentro", () => {
    expect(toIR(entities["order"]!)).toEqual(orderIR);
  });

  it("preserva `table` override em owned", () => {
    const ir: EntityIR = {
      irVersion: 1,
      name: "thing",
      fields: { parts: { kind: "owned", array: false, table: "custom_parts", shape: { x: { kind: "column", type: "text" } } } },
    };
    expect(toIR(fromIR([ir])["thing"]!)).toEqual(ir);
  });
});

describe("toIR — a partir do builder real (defineEntity)", () => {
  const category = defineEntity("category", { name: text().notNull().unique() });
  const product = defineEntity("product", {
    name: text().notNull(),
    price: int4().notNull(),
    description: text(),
    status: text().default("draft"),
    category: reference(category),
    tags: reference(array(category)),
  });
  const order = defineEntity("order", {
    code: text().notNull(),
    items: owned(
      array({
        sku: text().notNull(),
        quantity: int4().notNull(),
        category: reference(category),
      }),
    ),
  });

  it("serializa o schema-as-code do dev no IR esperado", () => {
    expect(toIR(category)).toEqual(categoryIR);
    expect(toIR(product)).toEqual(productIR);
    expect(toIR(order)).toEqual(orderIR);
  });

  it("não emite `id` (cunhado no servidor) nem timestamps managed", () => {
    const ir = toIR(product);
    for (const f of Object.values(ir.fields)) expect("id" in f).toBe(false);
    expect(ir.fields["createdAt"]).toBeUndefined();
    expect(ir.fields["updatedAt"]).toBeUndefined();
  });
});

describe("composite unique / index — to/from IR + normalize + diff", () => {
  it("toIR carrega os grupos; fromIR reconstrói options; round-trip estável", async () => {
    const stack = defineEntity("stack", { name: text().notNull() });
    const reg = defineEntity(
      "reg",
      { slugName: text().notNull(), stack: reference(stack) },
      { unique: [["slugName", "stack"]], index: [["slugName"]] },
    );
    const ir = toIR(reg);
    expect(ir.unique).toEqual([["slugName", "stack"]]);
    expect(ir.index).toEqual([["slugName"]]);

    const back = fromIR([toIR(stack), ir]);
    expect((back.reg as { options?: unknown }).options).toEqual({
      unique: [["slugName", "stack"]],
      index: [["slugName"]],
    });
    // round-trip: toIR(fromIR(ir)) reproduz os grupos.
    expect(toIR(back.reg!).unique).toEqual([["slugName", "stack"]]);
  });

  it("normalizeEntityIR cameliza os membros dos grupos (alinha com os campos)", async () => {
    const { normalizeEntityIR } = await import("@mauroandre/weave-core");
    const ir: EntityIR = {
      irVersion: 1,
      name: "reg",
      fields: { slug_name: { kind: "column", type: "text", notNull: true } },
      unique: [["slug_name"]],
    };
    const norm = normalizeEntityIR(ir);
    expect(Object.keys(norm.fields)).toEqual(["slugName"]); // campo camelizado
    expect(norm.unique).toEqual([["slugName"]]); // grupo acompanha
  });

  it("diffEntityIR: add unique composto = blocked; drop = auto; reorder = drop+add", async () => {
    const { diffEntityIR } = await import("@mauroandre/weave-core");
    const base: EntityIR = {
      irVersion: 1,
      name: "reg",
      fields: { a: { kind: "column", type: "text", id: "1" }, b: { kind: "column", type: "text", id: "2" } },
    };
    const withUq: EntityIR = { ...base, unique: [["a", "b"]] };

    const added = diffEntityIR(base, withUq).changes;
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ op: "addCompositeUnique", risk: "blocked", columns: ["a", "b"] });

    const dropped = diffEntityIR(withUq, base).changes;
    expect(dropped[0]).toMatchObject({ op: "dropCompositeUnique", risk: "auto" });

    // reorder das colunas = grupo diferente → drop do antigo + add do novo.
    const reordered = diffEntityIR(withUq, { ...base, unique: [["b", "a"]] }).changes;
    expect(reordered.map((c) => c.op).sort()).toEqual(["addCompositeUnique", "dropCompositeUnique"]);
  });
});

describe("mirror() builder → IR (owned que espelha outra entity)", () => {
  const product = defineEntity("product", { name: text().notNull(), price: int4() });

  it("owned(mirror(base)) 1:1 puro → { owned, mirror, sem shape }", () => {
    const e = defineEntity("snapshot", { item: owned(mirror(product)) });
    expect(toIR(e).fields.item).toEqual({ kind: "owned", array: false, mirror: "product" });
  });

  it("owned(array(mirror(base, { extras }))) 1:N → mirror + só os campos LOCAIS no shape", () => {
    const order = defineEntity("order", {
      items: owned(array(mirror(product, { quantity: int4().notNull() }))),
    });
    expect(toIR(order).fields.items).toEqual({
      kind: "owned",
      array: true,
      mirror: "product",
      shape: { quantity: { kind: "column", type: "int4", notNull: true } },
    });
  });

  it("mirror pega o nome do ENTITY-alvo (não string)", () => {
    // `mirror(product)` usa product.name — igual reference(product).
    const e = defineEntity("s", { m: owned(mirror(product)) });
    expect((toIR(e).fields.m as { mirror: string }).mirror).toBe("product");
  });
});
