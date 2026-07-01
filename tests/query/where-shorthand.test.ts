import { describe, it, expect } from "vitest";
import { array, bool, compileFind, defineEntity, int4, owned, reference, text, timestamptz } from "../../app/engine/index.js";

// Shorthand do WhereInput: um valor CRU num campo é açúcar pra `{ eq: valor }`
// (e `null` → `IS NULL`). Estes testes CERTIFICAM a equivalência — cada forma
// curta compila EXATAMENTE ao mesmo SQL+params da forma explícita. Puro (sem DB).

const category = defineEntity("category", {
  name: text().notNull(),
});

const product = defineEntity("product", {
  name: text().notNull(),
  price: int4(),
  active: bool(),
  releasedAt: timestamptz(),
  tags: array(text()),
  category: reference(category),
  items: owned(array({ qty: int4().notNull() })),
});

const compiled = (where: Parameters<typeof compileFind<typeof product>>[1] extends infer O ? O : never) =>
  compileFind(product, where as never);

/** Compila só a partir de `where` e devolve `{ text, params }`. */
const of = (where: unknown) => compiled({ where } as never);

/** Afirma que a forma CURTA e a forma EXPLÍCITA compilam idênticas. */
const same = (short: unknown, explicit: unknown) => expect(of(short)).toEqual(of(explicit));

const DATE = new Date("2020-06-15T12:00:00.000Z");

describe("where shorthand — { field: v } ≡ { field: { eq: v } }", () => {
  it("id: string cru ≡ eq (o caso que discutimos)", () => {
    same({ id: "123abc" }, { id: { eq: "123abc" } });
  });

  it("coluna text", () => same({ name: "Clean Code" }, { name: { eq: "Clean Code" } }));
  it("coluna int", () => same({ price: 80 }, { price: { eq: 80 } }));
  it("coluna bool", () => same({ active: true }, { active: { eq: true } }));
  it("coluna timestamptz (Date)", () => same({ releasedAt: DATE }, { releasedAt: { eq: DATE } }));

  it("campos gerenciados createdAt / updatedAt", () => {
    same({ createdAt: DATE }, { createdAt: { eq: DATE } });
    same({ updatedAt: DATE }, { updatedAt: { eq: DATE } });
  });

  it("FK de reference (categoryId) cru ≡ eq", () => {
    same({ categoryId: "cat-1" }, { categoryId: { eq: "cat-1" } });
  });

  it("cru dentro de and / or / not", () => {
    same({ or: [{ name: "A" }, { price: 5 }] }, { or: [{ name: { eq: "A" } }, { price: { eq: 5 } }] });
    same({ and: [{ active: true }] }, { and: [{ active: { eq: true } }] });
    same({ not: { name: "X" } }, { not: { name: { eq: "X" } } });
  });

  it("cru atravessando reference (category.name)", () => {
    same({ category: { name: "Books" } }, { category: { name: { eq: "Books" } } });
  });

  it("cru dentro de quantificador owned (items.some.qty)", () => {
    same({ items: { some: { qty: 3 } } }, { items: { some: { qty: { eq: 3 } } } });
  });

  it("múltiplos campos crus = AND de eqs", () => {
    same({ name: "A", price: 10, active: false }, { name: { eq: "A" }, price: { eq: 10 }, active: { eq: false } });
  });
});

describe("where shorthand — null ≡ eq:null ≡ isNull", () => {
  it("valor null vira IS NULL", () => {
    same({ price: null }, { price: { eq: null } });
    same({ price: null }, { price: { isNull: true } });
  });

  it("também aninhado", () => {
    same({ category: { name: null } }, { category: { name: { isNull: true } } });
  });
});

describe("where shorthand — SQL concreto", () => {
  it("{ id: '123abc' } → product.id = $1 com o param certo", () => {
    const { text: sql, params } = of({ id: "123abc" });
    const line = sql.split("\n").find((l) => l.startsWith("WHERE")) ?? "";
    expect(line).toBe("WHERE product.id = $1");
    expect(params).toEqual(["123abc"]);
  });

  it("{ price: null } → IS NULL, sem param", () => {
    const { text: sql, params } = of({ price: null });
    expect(sql).toContain("WHERE product.price IS NULL");
    expect(params).toEqual([]);
  });

  it("{ name: 'x', price: 5 } → dois eqs AND-combinados", () => {
    const { text: sql, params } = of({ name: "x", price: 5 });
    expect(sql).toContain("WHERE product.name = $1 AND product.price = $2");
    expect(params).toEqual(["x", 5]);
  });
});
