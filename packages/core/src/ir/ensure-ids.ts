import type { EntityIR, FieldIR } from "./types.js";

// Garante que todo campo do IR tenha um `id` estável. Regra de resolução:
//   1. já tem id → mantém;
//   2. não tem, mas existe um campo de mesmo nome no IR anterior → herda o id;
//   3. nada bate → cunha um UUID novo.
// É o que dá rename de graça pra GUI (que preserva o id) e estabilidade pra
// clientes "burros" da API (que só mandam nomes) no caso comum de não-rename.
export function ensureFieldIds(ir: EntityIR, previous: EntityIR | null): EntityIR {
  return { ...ir, fields: ensureFields(ir.fields, previous?.fields) };
}

function ensureFields(
  fields: Record<string, FieldIR>,
  prev: Record<string, FieldIR> | undefined,
): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const [key, node] of Object.entries(fields)) out[key] = ensureNode(node, prev?.[key]);
  return out;
}

function ensureNode(node: FieldIR, prev: FieldIR | undefined): FieldIR {
  const id = node.id ?? prev?.id ?? globalThis.crypto.randomUUID();
  if (node.kind === "owned" && node.shape) {
    const prevShape = prev?.kind === "owned" ? prev.shape : undefined;
    return { ...node, id, shape: ensureFields(node.shape, prevShape) };
  }
  return { ...node, id };
}
