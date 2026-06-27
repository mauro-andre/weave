import { beforeAll, describe, expect, it } from "vitest";
import { action_saveEntity } from "../app/pages/Entities.js";
import { action_saveObject, action_listObjects } from "../app/pages/Data.js";

// Reproduz pelo MESMO caminho da GUI (actions): owned-array `items` espelha
// `products`, que tem `category` (reference). Ou seja, há uma REFERENCE dentro de
// um OWNED. Queremos salvar um item com category e ler de volta populado.
const define = async (ir: unknown) => {
  const res = (await action_saveEntity({ body: { ir } })) as { error?: string };
  if (res.error) throw new Error(`entity: ${res.error}`);
};
const create = async (name: string, object: Record<string, unknown>) => {
  const res = (await action_saveObject({ body: { name, object } })) as {
    object?: { id: string };
    error?: string;
  };
  if (res.error || !res.object) throw new Error(`${name}: ${res.error ?? "no object"}`);
  return res.object;
};

// Nomes únicos: a sessão de testes compartilha um banco (reset 1x) e as tabelas
// persistem entre arquivos — evita colisão com outras suítes que usam `orders`.
describe("mirror trazendo reference dentro de owned (via actions)", () => {
  beforeAll(async () => {
    const { setup } = await import("../app/engine/control-plane/setup.js");
    await setup();
    await define({
      irVersion: 1,
      name: "mcat",
      fields: { name: { kind: "column", type: "text", notNull: true, unique: true } },
    });
    await define({
      irVersion: 1,
      name: "mprod",
      fields: {
        name: { kind: "column", type: "text", notNull: true },
        price: { kind: "column", type: "int4", notNull: true },
        category: { kind: "reference", target: "mcat", cardinality: "one" },
      },
    });
    await define({
      irVersion: 1,
      name: "mord",
      fields: {
        code: { kind: "column", type: "text", notNull: true },
        items: {
          kind: "owned",
          array: true,
          mirror: "mprod",
          shape: { quantity: { kind: "column", type: "int4", notNull: true } },
        },
      },
    });
  });

  it("salva pedido com item que tem category (reference dentro de owned) e lê de volta", async () => {
    const cat = await create("mcat", { name: "Electronics" });

    const order = await create("mord", {
      code: "ORD-1",
      items: [{ name: "Mouse", price: 50, quantity: 2, category: { id: cat.id } }],
    });

    const page = (await action_listObjects({
      body: { name: "mord", where: { id: { eq: order.id } } },
    })) as { docs?: Record<string, unknown>[]; error?: string };
    if (page.error) throw new Error(page.error);
    const item = (page.docs![0]!.items as Record<string, unknown>[])[0];
    expect(item?.category).toMatchObject({ id: cat.id, name: "Electronics" });
  });
});
