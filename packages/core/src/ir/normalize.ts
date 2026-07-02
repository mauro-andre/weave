import { camelize, tableize } from "../util/naming.js";
import type { EntityIR, FieldIR } from "./types.js";

// Normaliza os nomes do IR. ENTIDADE (e alvos de reference/mirror) usa `tableize`
// (nome lógico camelCase → tabela snake_case), MESMO tratamento dos campos, só no
// nível da entity: `backupStorages` → tabela `backup_storages`. CAMPO usa `camelize`
// (nome lógico); a COLUNA deriva via `camelToSnake`.
export function normalizeEntityIR(ir: EntityIR): EntityIR {
  const out: EntityIR = { ...ir, name: tableize(ir.name), fields: normFields(ir.fields) };
  // Grupos compostos referenciam campos → camelize cada membro (alinha com os
  // nomes de campo canônicos). Omitidos quando vazios.
  if (ir.unique?.length) out.unique = ir.unique.map((g) => g.map(camelize));
  else delete out.unique;
  if (ir.index?.length) out.index = ir.index.map((g) => g.map(camelize));
  else delete out.index;
  // partitionBy referencia um campo → camelize o nome (alinha com os campos canônicos).
  if (ir.partitionBy) out.partitionBy = { ...ir.partitionBy, field: camelize(ir.partitionBy.field) };
  return out;
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
        mirror: tableize(node.mirror),
        ...(node.shape ? { shape: normFields(node.shape) } : {}),
      };
    }
    return { ...node, shape: normFields(node.shape ?? {}) };
  }
  if (node.kind === "reference") return { ...node, target: tableize(node.target) };
  return node;
}
