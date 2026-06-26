import { Column } from "../schema/column.js";
import { Owned, type OwnedShape } from "../schema/owned.js";
import { Reference } from "../schema/reference.js";
import type { Entity, ShapeRecord } from "../schema/entity.js";
import type { ColumnIR, EntityIR, FieldIR, OwnedIR, ReferenceIR } from "./types.js";

/**
 * Serializa um `Entity` (saída do `defineEntity`) de volta pro IR JSON — o
 * caminho de IDA, inverso do `fromIR`. É o elo que o SDK usa pra transformar o
 * schema-as-code do dev no IR que o `push` manda pro servidor.
 *
 * Escopo: formas CONCRETAS (column/owned/reference). `mirror` é resolvido ANTES
 * do `fromIR` no pipeline real, e o builder ainda não carrega marca de mirror,
 * então `toIR` não emite `mirror` (fica pra quando o builder ganhar `mirror()`).
 * Também não emite `id`: ids são cunhados no servidor (o dev escreve id-less).
 *
 * Saída CANÔNICA/mínima: optionals falsos são omitidos (`array:false`,
 * `notNull:false`, …), pra `toIR(fromIR(ir))` reproduzir o IR mínimo de origem.
 */
export function toIR(entity: Entity<string, ShapeRecord>): EntityIR {
  return { irVersion: 1, name: entity.name, fields: shapeToIR(entity.columns) };
}

function shapeToIR(shape: ShapeRecord | OwnedShape): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const [key, node] of Object.entries(shape)) out[key] = nodeToIR(node);
  return out;
}

function nodeToIR(node: ShapeRecord[string]): FieldIR {
  if (node instanceof Column) {
    const c = node.config;
    const ir: ColumnIR = { kind: "column", type: c.pgType.name };
    if (c.isArray) ir.array = true;
    if (c.notNull) ir.notNull = true;
    if (c.hasDefault) ir.default = c.default;
    if (c.unique) ir.unique = true;
    if (c.index) ir.index = true;
    return ir;
  }
  if (node instanceof Reference) {
    const ir: ReferenceIR = {
      kind: "reference",
      target: node.target.name,
      cardinality: node.cardinality,
    };
    if (node.isNotNull) ir.notNull = true;
    return ir;
  }
  if (node instanceof Owned) {
    const ir: OwnedIR = {
      kind: "owned",
      array: node.cardinality === "many",
      shape: shapeToIR(node.shape),
    };
    if (node.options.table !== undefined) ir.table = node.options.table;
    return ir;
  }
  throw new Error("toIR — nó desconhecido no shape (esperado Column/Owned/Reference).");
}
