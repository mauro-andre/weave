import { describe, expect, it } from "vitest";
import { toIR, fromIR, type EntityIR } from "@mauroandre/weave-core";
import { defineEntity, text, int4, owned, reference, array } from "../app/engine/index.js";

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
