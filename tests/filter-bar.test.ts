import { describe, it, expect } from "vitest";
import { decode, leafFilter, NO_VALUE, OP_LABEL, operatorsFor } from "../app/pages/FilterBar.js";
import type { ColumnIR } from "@mauroandre/weave-core";

const col = (type: string, array = false): ColumnIR => ({ kind: "column", type, array });

/** Shape de uma entidade com um campo de cada família que a barra conhece. */
const shapes = {
  post: {
    title: col("text"),
    views: col("int4"),
    publishedAt: col("timestamptz"),
    ref: col("uuid"),
    flag: col("bool"),
    tags: col("text", true),
  },
};

const labelsOf = (type: string, array = false): string[] =>
  operatorsFor(col(type, array)).map((o) => o.label);

describe("filter bar — operadores \"is (not) empty\"", () => {
  it("oferece \"is not empty\" logo após \"is empty\" nos quatro grupos escalares", () => {
    for (const t of ["text", "int4", "timestamptz", "uuid"]) {
      const labels = labelsOf(t);
      const i = labels.indexOf("is empty");
      expect(i, `tipo ${t} deveria ter "is empty"`).toBeGreaterThanOrEqual(0);
      expect(labels[i + 1], `tipo ${t}: "is not empty" deveria vir logo após "is empty"`).toBe("is not empty");
    }
  });

  it("booleano não ganha operadores de nulidade", () => {
    const labels = labelsOf("bool");
    expect(labels).toEqual(["is true", "is false"]);
  });

  it("array não ganha empty e mantém o prefixo any nos escalares", () => {
    const labels = labelsOf("text", true);
    expect(labels).not.toContain("is empty");
    expect(labels).not.toContain("is not empty");
    expect(labels).not.toContain("any is empty");
    expect(labels).not.toContain("any is not empty");
    expect(labels[0]).toBe("any contains");
  });

  it("\"is not empty\" é operador sem valor com rótulo próprio", () => {
    expect(NO_VALUE.has("isNotEmpty")).toBe(true);
    expect(OP_LABEL["isNotEmpty"]).toBe("is not empty");
  });

  it("emite a nulidade negada do escalar (`isNull: false`), nada além", () => {
    expect(leafFilter(col("text"), "isNotEmpty")).toEqual({ isNull: false });
    expect(leafFilter(col("uuid"), "isNotEmpty")).toEqual({ isNull: false });
    // O "is empty" existente não muda.
    expect(leafFilter(col("text"), "isEmpty")).toEqual({ isNull: true });
  });

  it("decode reconhece as formas negadas sem degradar para \"is empty\"", () => {
    // O round-trip da própria barra: emissão → where → decode de volta.
    const roundTrip = decode({ title: leafFilter(col("text"), "isNotEmpty") }, shapes, "post");
    expect(roundTrip).toEqual({ match: "all", conditions: [{ path: ["title"], op: "isNotEmpty" }] });

    // Formas negadas escritas à mão no WhereInput também reconhecem.
    expect(decode({ title: { isNull: false } }, shapes, "post").conditions[0]?.op).toBe("isNotEmpty");
    expect(decode({ tags: { isEmpty: false } }, shapes, "post").conditions[0]?.op).toBe("isNotEmpty");

    // As formas positivas continuam decodificando como "is empty".
    expect(decode({ title: { isNull: true } }, shapes, "post").conditions[0]?.op).toBe("isEmpty");
    expect(decode({ tags: { isEmpty: true } }, shapes, "post").conditions[0]?.op).toBe("isEmpty");
  });
});
