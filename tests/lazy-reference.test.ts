import { describe, it, expect } from "vitest";
import { toIR, type EntityIR } from "@mauroandre/weave-core";
import { defineEntity, text, reference, array, self, irToSource, buildLazyRefPredicate } from "@mauroandre/weave-sdk";

// Peça 1 (expressão lazy): reference(() => other) pro ciclo mútuo e reference(self())
// pro self-ref. Testes PUROS (sem banco): (1) o toIR resolve eager/thunk/self pro nome
// certo; (2) a detecção de ciclo do gen (buildLazyRefPredicate) acende só as arestas
// cíclicas; (3) o irToSource emite eager/lazy/self conforme o predicado. O push do
// ciclo mútuo (DDL) fica pra Peça 2 — aqui só a EXPRESSÃO.

describe("toIR — resolução de reference eager / thunk / self", () => {
  const category = defineEntity("category", { name: text().notNull() });

  it("eager N:1 continua resolvendo pro nome do alvo", () => {
    const product = defineEntity("product", { category: reference(category) });
    expect(toIR(product).fields.category).toEqual({ kind: "reference", target: "category", cardinality: "one" });
  });

  it("thunk N:1 (() => other) resolve pro nome do alvo", () => {
    const product = defineEntity("product", { category: reference(() => category) });
    expect(toIR(product).fields.category).toEqual({ kind: "reference", target: "category", cardinality: "one" });
  });

  it("thunk N:N (array(() => other)) resolve pro nome, cardinality many", () => {
    const product = defineEntity("product", { tags: reference(array(() => category)) });
    expect(toIR(product).fields.tags).toEqual({ kind: "reference", target: "category", cardinality: "many" });
  });

  it("self() N:1 → alvo = a própria entity", () => {
    const node = defineEntity("node", { text: text().notNull(), parent: reference(self()) });
    expect(toIR(node).fields.parent).toEqual({ kind: "reference", target: "node", cardinality: "one" });
  });

  it("self() N:N → alvo = a própria entity, cardinality many", () => {
    // O caso do Perfil MCP: users.directManagers → users.
    const users = defineEntity("users", { email: text().notNull(), directManagers: reference(array(self())) });
    expect(toIR(users).fields.directManagers).toEqual({ kind: "reference", target: "users", cardinality: "many" });
  });

  it("thunk N:1 com .notNull() preserva notNull ao resolver", () => {
    const users = defineEntity("users2", { company: reference(() => category).notNull() });
    expect(toIR(users).fields.company).toEqual({ kind: "reference", target: "category", cardinality: "one", notNull: true });
  });

  it("thunk que devolve o NAMESPACE do módulo (import circular via jiti) desembrulha o default", () => {
    // Regressão do bug 0.0.29: no `weave push` (discovery de disco com jiti), o módulo
    // lido por SEGUNDO num ciclo recebe do thunk o NAMESPACE do primeiro (`{ default:
    // entity }`), não a entity. Sem desembrulhar, `target.name` é undefined → o
    // JSON.stringify do push descarta o campo → o server acusa "target must be a string".
    const ns = { default: category } as unknown as typeof category; // o que o jiti entrega no ciclo
    const owner = defineEntity("nsprod", { category: reference(() => ns) });
    expect(toIR(owner).fields.category).toEqual({ kind: "reference", target: "category", cardinality: "one" });
  });
});

describe("gen — detecção de ciclo (buildLazyRefPredicate)", () => {
  const ir = (name: string, fields: EntityIR["fields"]): EntityIR => ({ irVersion: 1, name, fields });
  const ref = (target: string, cardinality: "one" | "many" = "one") => ({ kind: "reference" as const, target, cardinality });

  it("acíclico → nenhuma aresta é lazy (PodCubo)", () => {
    const isLazy = buildLazyRefPredicate([
      ir("product", { category: ref("category") }),
      ir("category", { name: { kind: "column", type: "text", notNull: true } }),
    ]);
    expect(isLazy("product", "category")).toBe(false);
  });

  it("ciclo mútuo → as DUAS arestas são lazy", () => {
    const isLazy = buildLazyRefPredicate([
      ir("company", { consultant: ref("users") }),
      ir("users", { company: ref("company") }),
    ]);
    expect(isLazy("company", "users")).toBe(true);
    expect(isLazy("users", "company")).toBe(true);
  });

  it("ciclo transitivo (3 saltos) → todas as arestas do ciclo são lazy", () => {
    const isLazy = buildLazyRefPredicate([
      ir("order", { invoice: ref("invoice") }),
      ir("invoice", { customer: ref("customer") }),
      ir("customer", { order: ref("order") }),
    ]);
    expect(isLazy("order", "invoice")).toBe(true);
    expect(isLazy("invoice", "customer")).toBe(true);
    expect(isLazy("customer", "order")).toBe(true);
  });

  it("misto: aresta acíclica fica eager, cíclica fica lazy, na mesma entity", () => {
    const isLazy = buildLazyRefPredicate([
      ir("users", { country: ref("country"), company: ref("company") }),
      ir("country", { name: { kind: "column", type: "text" } }),
      ir("company", { owner: ref("users") }), // volta em users → cíclica
    ]);
    expect(isLazy("users", "country")).toBe(false); // country não volta em users
    expect(isLazy("users", "company")).toBe(true); // company volta em users
  });

  it("reference DENTRO de owned também conta pro ciclo", () => {
    const isLazy = buildLazyRefPredicate([
      ir("a", { items: { kind: "owned", array: true, shape: { b: ref("b") } } }),
      ir("b", { a: ref("a") }),
    ]);
    expect(isLazy("a", "b")).toBe(true);
  });
});

describe("gen — irToSource emite eager / lazy / self", () => {
  const ir = (name: string, fields: EntityIR["fields"]): EntityIR => ({ irVersion: 1, name, fields });

  it("sem predicado → cross-ref fica eager (chamada avulsa)", () => {
    const src = irToSource(ir("product", { category: { kind: "reference", target: "category", cardinality: "one" } }));
    expect(src).toContain("category: reference(category),");
    expect(src).toContain('import category from "./category.js";');
  });

  it("predicado true → cross-ref vira thunk lazy, mantendo o import", () => {
    const src = irToSource(
      ir("company", { consultant: { kind: "reference", target: "users", cardinality: "one" } }),
      { isLazyRef: (from, to) => from === "company" && to === "users" },
    );
    expect(src).toContain("consultant: reference(() => users),");
    expect(src).toContain('import users from "./users.js";');
  });

  it("N:N cíclico → reference(array(() => other))", () => {
    const src = irToSource(
      ir("company", { staff: { kind: "reference", target: "users", cardinality: "many" } }),
      { isLazyRef: () => true },
    );
    expect(src).toContain("staff: reference(array(() => users)),");
  });

  it("self-ref N:N → reference(array(self())), SEM auto-import", () => {
    const src = irToSource(ir("users", { directManagers: { kind: "reference", target: "users", cardinality: "many" } }));
    expect(src).toContain("directManagers: reference(array(self())),");
    expect(src).toContain("self"); // self está nos builders importados do SDK
    expect(src).not.toContain('import users from "./users.js";'); // não importa a si mesmo
  });

  it("self-ref N:1 → reference(self()) (com .notNull())", () => {
    const src = irToSource(ir("node", { parent: { kind: "reference", target: "node", cardinality: "one", notNull: true } }));
    expect(src).toContain("parent: reference(self()).notNull(),");
  });
});
