import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  reference,
  self,
  text,
  type InferEntity,
  type InferInsert,
} from "../../app/engine/index.js";
// Ciclo mútuo em MÓDULOS separados (import circular) — o cenário real do gen. Um teste
// single-file degradaria o `const` que faz forward-ref; separado, o TS resolve o ciclo.
import lzCompany from "./fixtures/lzCompany.js";
import lzUsers from "./fixtures/lzUsers.js";

// Type-tests da Peça 1 (expressão lazy). Três casos: N:1 lazy (thunk), ciclo mútuo
// (thunk nas duas direções), e self-ref (`self()`). O ponto crítico do self-ref é que
// ele COMPILA — se referenciasse a entity por valor (`() => users` no próprio const),
// bateria o muro "referenced directly or indirectly in its own initializer".

describe("N:1 lazy (thunk) — mesma inferência do eager", () => {
  const category = defineEntity("lz_category", { name: text().notNull() });
  const product = defineEntity("lz_product", {
    name: text().notNull(),
    category: reference(() => category), // thunk
  });

  it("InferInsert expõe <field>Id preciso (thunk == eager na base/insert)", () => {
    expectTypeOf<InferInsert<typeof product>>().toEqualTypeOf<{
      id?: string;
      name: string;
      categoryId?: string | null; // N:1 nullable no insert
    }>();
  });

  it("base InferEntity: categoryId preciso (string|null); colunas irmãs intactas", () => {
    expectTypeOf<InferEntity<typeof product>["categoryId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InferEntity<typeof product>["name"]>().toEqualTypeOf<string>();
  });
  // (o `expand` de um ref LAZY é frouxo de propósito — quem quer expand tipado usa o
  //  overload eager `reference(x)`, coberto nos type-tests de N:1/N:N/nested.)
});

describe("ciclo mútuo (thunk nas duas direções, módulos separados) — infere os FKs", () => {
  // Campo-a-campo: o `toEqualTypeOf` no objeto inteiro engasga com o phantom target
  // mutuamente recursivo. As colunas escalares e os FK ids provam que a inferência
  // resolve o ciclo (import circular) sem degradar.
  it("company: name é string, consultantId é string|null (nullable)", () => {
    expectTypeOf<InferEntity<typeof lzCompany>["name"]>().toEqualTypeOf<string>();
    expectTypeOf<InferEntity<typeof lzCompany>["consultantId"]>().toEqualTypeOf<string | null>();
  });

  it("users: email é string, companyId é string (notNull)", () => {
    expectTypeOf<InferEntity<typeof lzUsers>["email"]>().toEqualTypeOf<string>();
    expectTypeOf<InferEntity<typeof lzUsers>["companyId"]>().toEqualTypeOf<string>();
  });
});

describe("self-ref (self()) — compila sem ciclo de inferência de const", () => {
  // Se `self()` referenciasse `member` por valor, este `const` não compilaria.
  const member = defineEntity("lz_member", {
    name: text().notNull(),
    directManagers: reference(array(self())), // N:N pra si mesma
    manager: reference(self()), // N:1 pra si mesma
  });

  it("base é limpa (só o FK id do N:1, N:N não vem por default)", () => {
    expectTypeOf<InferEntity<typeof member>>().toEqualTypeOf<{
      id: string;
      name: string;
      managerId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });

  it("InferInsert expõe directManagersIds e managerId", () => {
    expectTypeOf<InferInsert<typeof member>>().toEqualTypeOf<{
      id?: string;
      name: string;
      managerId?: string | null;
      directManagersIds?: string[];
    }>();
  });
});
