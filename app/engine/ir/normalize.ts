import { slug } from "../util/slug.js";
import type { EntityIR, FieldIR } from "./types.js";

// Normaliza os nomes do IR (entidade, campos, shapes owned, alvos de reference)
// para identificadores SQL-safe. Aplicado no back quando o IR chega.
export function normalizeEntityIR(ir: EntityIR): EntityIR {
  return { ...ir, name: slug(ir.name), fields: normFields(ir.fields) };
}

function normFields(fields: Record<string, FieldIR>): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const [key, node] of Object.entries(fields)) out[slug(key)] = normNode(node);
  return out;
}

function normNode(node: FieldIR): FieldIR {
  if (node.kind === "owned") return { ...node, shape: normFields(node.shape) };
  if (node.kind === "reference") return { ...node, target: slug(node.target) };
  return node;
}
