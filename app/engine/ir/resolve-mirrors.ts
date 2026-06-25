import type { EntityIR, FieldIR } from "./types.js";

// Expande os owned com `mirror` na forma concreta da entidade base. Roda antes do
// fromIR/sync, lendo a forma VIVA do metastore — por isso re-salvar = re-resolver.
export function resolveMirrors(ir: EntityIR, byName: Map<string, EntityIR>): EntityIR {
  return { ...ir, fields: resolveFields(ir.fields, byName, new Set()) };
}

function resolveFields(
  fields: Record<string, FieldIR>,
  byName: Map<string, EntityIR>,
  seen: Set<string>,
): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const [key, node] of Object.entries(fields)) out[key] = resolveNode(node, byName, seen);
  return out;
}

function resolveNode(node: FieldIR, byName: Map<string, EntityIR>, seen: Set<string>): FieldIR {
  if (node.kind !== "owned") return node;
  if (node.mirror) {
    const base = byName.get(node.mirror);
    if (!base) throw new Error(`IR — mirror para entidade desconhecida: '${node.mirror}'.`);
    if (seen.has(node.mirror)) throw new Error(`IR — mirror cíclico em '${node.mirror}'.`);
    const baseShape = resolveFields(base.fields, byName, new Set(seen).add(node.mirror));
    // Campos locais (extras) são anexados à forma da base; em colisão, o local vence.
    const localShape = node.shape ? resolveFields(node.shape, byName, seen) : {};
    return {
      kind: "owned",
      array: node.array,
      shape: { ...baseShape, ...localShape },
      ...(node.table !== undefined ? { table: node.table } : {}),
    };
  }
  return { ...node, shape: resolveFields(node.shape ?? {}, byName, seen) };
}
