import { slug } from "../util/slug.js";
import { camelize } from "../util/naming.js";
import type { EntityIR, FieldIR } from "./types.js";

// Normaliza os nomes do IR. ENTIDADE (vira nome de tabela) e alvos de reference/mirror
// usam `slug` (snake_case, minúsculo). CAMPO usa `camelize` (camelCase canônico) — o
// nome lógico do dev; a COLUNA no Postgres deriva dele via `camelToSnake` (snake_case).
export function normalizeEntityIR(ir: EntityIR): EntityIR {
  return { ...ir, name: slug(ir.name), fields: normFields(ir.fields) };
}

function normFields(fields: Record<string, FieldIR>): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const [key, node] of Object.entries(fields)) out[camelize(key)] = normNode(node);
  return out;
}

function normNode(node: FieldIR): FieldIR {
  if (node.kind === "owned") {
    // Com mirror: normaliza o alvo e, se houver, os campos locais (extras).
    if (node.mirror) {
      return {
        ...node,
        mirror: slug(node.mirror),
        ...(node.shape ? { shape: normFields(node.shape) } : {}),
      };
    }
    return { ...node, shape: normFields(node.shape ?? {}) };
  }
  if (node.kind === "reference") return { ...node, target: slug(node.target) };
  return node;
}
