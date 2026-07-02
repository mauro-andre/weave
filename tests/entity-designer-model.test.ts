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

describe("EntityDesigner — partição IR ↔ model", () => {
  const partIr: EntityIR = {
    irVersion: 1,
    name: "appReq",
    fields: {
      host: { kind: "column", id: "h", type: "text", notNull: true },
      ts: { kind: "column", id: "t", type: "timestamptz", notNull: true },
    },
    partitionBy: { field: "ts", interval: "1d" },
    retention: "30d",
  };

  it("irToModel liga a partição, mapeia o campo→id e separa o bucket/retenção", () => {
    const m = irToModel(partIr);
    expect(m.partition.enabled).toBe(true);
    expect(m.partition.fieldId).toBe("t"); // ts → id
    expect(m.partition.interval).toBe("1d");
    expect(m.partition.keepForever).toBe(false);
    expect(m.partition.retention).toBe("30d");
  });

  it("round-trip estável reproduz partitionBy + retention", () => {
    const back = toIR(irToModel(partIr));
    expect(back.partitionBy).toEqual({ field: "ts", interval: "1d" });
    expect(back.retention).toBe("30d");
  });

  it("partitionBy sem retention → keepForever (modo 2), e volta sem retention", () => {
    const { retention, ...noRet } = partIr; // omite a chave (não seta undefined)
    void retention;
    const m = irToModel(noRet);
    expect(m.partition.keepForever).toBe(true);
    const back = toIR(m);
    expect(back.partitionBy).toEqual({ field: "ts", interval: "1d" });
    expect(back.retention).toBeUndefined();
  });

  it("rename-proof: renomear o campo de tempo re-emite o partitionBy com o nome novo", () => {
    const m = irToModel(partIr);
    m.fields.find((f) => f.id === "t")!.name = "eventAt"; // rename via GUI
    expect(toIR(m).partitionBy).toEqual({ field: "eventAt", interval: "1d" });
  });

  it("campo não-elegível (não é timestamptz notNull) não emite partitionBy", () => {
    const m = irToModel(partIr);
    m.fields.find((f) => f.id === "t")!.notNull = false; // deixa de ser elegível
    expect(toIR(m).partitionBy).toBeUndefined();
  });

  it("desligada → sem partitionBy/retention no IR", () => {
    const m = irToModel(partIr);
    m.partition.enabled = false;
    const back = toIR(m);
    expect(back.partitionBy).toBeUndefined();
    expect(back.retention).toBeUndefined();
  });
});
