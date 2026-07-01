import { describe, it, expect } from "vitest";
import type { EntityIR } from "@mauroandre/weave-core";
import { toIR, irToModel } from "../app/pages/EntityDesigner.js";

// A GUI do designer edita um `EntityModel` e serializa pro IR. Os compostos (unique/
// index de entidade) referenciam campos por ID (rename-proof) e o `toIR` resolve pro
// nome atual. Testes puros do round-trip IR ↔ model (sem render).

const ir: EntityIR = {
  irVersion: 1,
  name: "reg",
  fields: {
    slugName: { kind: "column", id: "f1", type: "text", notNull: true },
    stack: { kind: "reference", id: "f2", target: "stack", cardinality: "one" },
    host: { kind: "column", id: "f3", type: "text" },
  },
  unique: [["slugName", "stack"]],
  index: [["host", "slugName"]],
};

describe("EntityDesigner — compostos IR ↔ model", () => {
  it("irToModel lê os grupos mapeando nome→id; toIR reproduz por nome", () => {
    const m = irToModel(ir);
    // dois compostos, referenciando os ids dos campos
    expect(m.composites).toHaveLength(2);
    const uq = m.composites.find((c) => c.kind === "unique")!;
    const idx = m.composites.find((c) => c.kind === "index")!;
    expect(uq.fieldIds).toEqual(["f1", "f2"]); // slugName, stack → ids
    expect(idx.fieldIds).toEqual(["f3", "f1"]); // host, slugName → ids

    const back = toIR(m);
    expect(back.unique).toEqual([["slugName", "stack"]]);
    expect(back.index).toEqual([["host", "slugName"]]);
  });

  it("round-trip estável: toIR(irToModel(ir)) reproduz os grupos", () => {
    const back = toIR(irToModel(ir));
    expect(back.unique).toEqual(ir.unique);
    expect(back.index).toEqual(ir.index);
  });

  it("rename-proof: renomear um campo do grupo re-emite com o NOME NOVO (id preservado)", () => {
    const m = irToModel(ir);
    m.fields.find((f) => f.name === "slugName")!.name = "slug"; // rename via GUI
    const back = toIR(m);
    expect(back.unique).toEqual([["slug", "stack"]]); // grupo acompanhou o rename
    expect(back.index).toEqual([["host", "slug"]]);
  });

  it("elegibilidade: um campo que virou owned some do grupo (toIR filtra)", () => {
    const m = irToModel(ir);
    m.fields.find((f) => f.name === "host")!.family = "ownedOne"; // não é mais coluna
    const back = toIR(m);
    // o índice [host, slugName] perde `host` → vira [slugName]
    expect(back.index).toEqual([["slugName"]]);
    expect(back.unique).toEqual([["slugName", "stack"]]); // unique intacto
  });

  it("grupo vazio (nenhum campo elegível) é omitido do IR", () => {
    const m = irToModel({ irVersion: 1, name: "x", fields: { a: { kind: "column", id: "a1", type: "text" } } });
    m.composites.push({ id: "c1", kind: "unique", fieldIds: [] });
    const back = toIR(m);
    expect(back.unique).toBeUndefined();
    expect(back.index).toBeUndefined();
  });
});
