import { beforeAll, describe, expect, it } from "vitest";
import { action_saveEntity, loader as entitiesLoader } from "../app/pages/Entities.js";
import type { EntityIR, FieldIR } from "@mauroandre/weave-core";

// O client pode mandar `id` por campo desde a CRIAÇÃO (write-back inline / `$id`
// à mão). O servidor RESPEITA o que veio e CUNHA onde falta. Depois disso, o
// fluxo é o de sempre. Tudo exercitado pelas actions (mesmo caminho da GUI).

const save = async (ir: unknown) =>
  (await action_saveEntity({ body: { ir } })) as { ok?: boolean; status?: string; error?: string };

const readIR = async (name: string): Promise<EntityIR> => {
  const all = (await entitiesLoader({} as never)) as EntityIR[];
  const ir = all.find((e) => e.name === name);
  if (!ir) throw new Error(`entidade '${name}' não encontrada`);
  return ir;
};

const idOf = (ir: EntityIR, key: string): string | undefined => (ir.fields[key] as FieldIR)?.id;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("ids fornecidos pelo client na criação da entidade", () => {
  beforeAll(async () => {
    const { setup } = await import("../app/engine/control-plane/setup.js");
    await setup();
  });

  it("nenhum id fornecido → o servidor cunha UUID em todo campo", async () => {
    const res = await save({
      irVersion: 1,
      name: "idnone",
      fields: {
        title: { kind: "column", type: "text", notNull: true },
        price: { kind: "column", type: "int4" },
      },
    });
    expect(res.ok).toBe(true);
    const ir = await readIR("idnone");
    expect(idOf(ir, "title")).toMatch(UUID);
    expect(idOf(ir, "price")).toMatch(UUID);
    expect(idOf(ir, "title")).not.toBe(idOf(ir, "price"));
  });

  it("todos os ids fornecidos → o servidor preserva exatamente (inclusive ids legíveis)", async () => {
    const res = await save({
      irVersion: 1,
      name: "idall",
      fields: {
        title: { kind: "column", type: "text", notNull: true, id: "fld_title" },
        price: { kind: "column", type: "int4", id: "fld_price" },
      },
    });
    expect(res.ok).toBe(true);
    const ir = await readIR("idall");
    expect(idOf(ir, "title")).toBe("fld_title");
    expect(idOf(ir, "price")).toBe("fld_price");
  });

  it("misto → preserva os fornecidos e cunha só onde falta", async () => {
    const res = await save({
      irVersion: 1,
      name: "idmix",
      fields: {
        title: { kind: "column", type: "text", notNull: true, id: "keep_me" },
        price: { kind: "column", type: "int4" }, // sem id → cunhado
        note: { kind: "column", type: "text", id: "keep_note" },
      },
    });
    expect(res.ok).toBe(true);
    const ir = await readIR("idmix");
    expect(idOf(ir, "title")).toBe("keep_me");
    expect(idOf(ir, "note")).toBe("keep_note");
    expect(idOf(ir, "price")).toMatch(UUID); // cunhado
  });

  it("owned aninhado misto → respeita/cunha em qualquer profundidade", async () => {
    const res = await save({
      irVersion: 1,
      name: "idnested",
      fields: {
        code: { kind: "column", type: "text", notNull: true },
        lines: {
          kind: "owned",
          array: true,
          id: "own_lines",
          shape: {
            qty: { kind: "column", type: "int4", notNull: true, id: "own_qty" },
            label: { kind: "column", type: "text" }, // sem id → cunhado
          },
        },
      },
    });
    expect(res.ok).toBe(true);
    const ir = await readIR("idnested");
    const lines = ir.fields["lines"] as Extract<FieldIR, { kind: "owned" }>;
    expect(lines.id).toBe("own_lines");
    expect(idOf({ fields: lines.shape! } as EntityIR, "qty")).toBe("own_qty");
    expect(idOf({ fields: lines.shape! } as EntityIR, "label")).toMatch(UUID);
    expect(idOf(ir, "code")).toMatch(UUID);
  });

  it("id duplicado na entidade → rejeitado (mesmo entre topo e owned aninhado)", async () => {
    const res = await save({
      irVersion: 1,
      name: "iddup",
      fields: {
        title: { kind: "column", type: "text", id: "same" },
        lines: {
          kind: "owned",
          array: false,
          shape: { inner: { kind: "column", type: "text", id: "same" } }, // colide com title
        },
      },
    });
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/duplicate field id 'same'/);
  });

  it("id vazio/ inválido → rejeitado", async () => {
    const res = await save({
      irVersion: 1,
      name: "idempty",
      fields: { title: { kind: "column", type: "text", id: "" } },
    });
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/`id` must be a non-empty string/);
  });

  it("uma vez criada com ids, re-salvar sem mexer mantém os mesmos ids (segue como hoje)", async () => {
    await save({
      irVersion: 1,
      name: "idstable",
      fields: { title: { kind: "column", type: "text", id: "t1" }, price: { kind: "column", type: "int4" } },
    });
    const first = await readIR("idstable");
    const mintedPrice = idOf(first, "price")!;

    // re-save id-less (cliente "burro" mandando só nomes) → herda por nome.
    const res = await save({
      irVersion: 1,
      name: "idstable",
      fields: { title: { kind: "column", type: "text" }, price: { kind: "column", type: "int4" } },
    });
    expect(res.ok).toBe(true);
    const second = await readIR("idstable");
    expect(idOf(second, "title")).toBe("t1");
    expect(idOf(second, "price")).toBe(mintedPrice);
  });
});
