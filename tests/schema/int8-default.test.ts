import { describe, it, expect } from "vitest";
import { int8, defineEntity, toIR } from "../../app/engine/index.js";
import { irToSource } from "@mauroandre/weave-sdk";

// int8 é backed por `bigint`, mas `.default()` aceita number|bigint e GUARDA como
// number — o default vive no IR (jsonb), e `bigint` não serializa em JSON. Sem isso,
// `int8().default(0)` não compilava (report do PodCubo) e `default(0n)` quebraria o push.

describe("int8 default — number|bigint, guardado como number (IR jsonb-safe)", () => {
  it(".default(0) guarda o number 0", () => {
    const c = int8().notNull().default(0);
    expect(c.config.default).toBe(0);
    expect(typeof c.config.default).toBe("number");
  });

  it(".default(0n) coage bigint→number (senão o IR jsonb quebraria)", () => {
    const c = int8().notNull().default(0n);
    expect(c.config.default).toBe(0);
    expect(typeof c.config.default).toBe("number"); // não bigint
  });

  it("toIR emite default number e o IR serializa em JSON (o push manda jsonb)", () => {
    const e = defineEntity("bigrec", { size: int8().notNull().default(0n) });
    const ir = toIR(e);
    expect(ir.fields.size).toMatchObject({ type: "int8", notNull: true, default: 0 });
    expect(() => JSON.stringify(ir)).not.toThrow();
  });

  it("gen emite int8().notNull().default(0) — o arquivo gerado compila sem edição", () => {
    const ir = {
      irVersion: 1,
      name: "bigrec",
      fields: { size: { kind: "column", type: "int8", notNull: true, default: 0 } },
    } as const;
    const src = irToSource(ir as never);
    expect(src).toContain("size: int8().notNull().default(0)");
    expect(src).not.toContain("0n"); // number, não bigint
  });
});
