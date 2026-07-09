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
 * Emite `id` quando o campo o carrega (via `.$id(...)`, normalmente do `weave
 * gen`); ausente em campos id-less escritos à mão (o servidor cunha no apply).
 *
 * Saída CANÔNICA/mínima: optionals falsos são omitidos (`array:false`,
 * `notNull:false`, …), pra `toIR(fromIR(ir))` reproduzir o IR mínimo de origem.
 */
export function toIR(entity: Entity<string, ShapeRecord>): EntityIR {
  const ir: EntityIR = { irVersion: 1, name: entity.name, fields: shapeToIR(entity.columns, entity.name) };
  // Grupos compostos passam crus (nomes lógicos); o `normalizeEntityIR` os cameliza
  // junto com os campos. Omitidos quando ausentes (IR canônico/mínimo).
  if (entity.options?.unique?.length) ir.unique = entity.options.unique.map((g) => [...g]);
  if (entity.options?.index?.length) ir.index = entity.options.index.map((g) => [...g]);
  // partitionBy é um GroupExpr (`timeBucket(field, interval)`) → achata pro IR.
  const pb = entity.options?.partitionBy;
  if (pb) ir.partitionBy = { field: pb.timeBucket.field, interval: pb.timeBucket.interval };
  if (entity.options?.retention) ir.retention = entity.options.retention;
  return ir;
}

function shapeToIR(shape: ShapeRecord | OwnedShape, selfName: string): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const [key, node] of Object.entries(shape)) out[key] = nodeToIR(node, selfName);
  return out;
}

// `selfName` = nome da entity-RAIZ que está sendo serializada. Desce pelos owned
// intacto: `self()` sempre aponta pra raiz, em qualquer profundidade.
function nodeToIR(node: ShapeRecord[string], selfName: string): FieldIR {
  if (node instanceof Column) {
    const c = node.config;
    const ir: ColumnIR = { kind: "column", type: c.pgType.name };
    if (c.id) ir.id = c.id;
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
      target: node.targetName(selfName), // resolve eager/thunk/self → nome
      cardinality: node.cardinality,
    };
    if (node.id) ir.id = node.id;
    if (node.isNotNull) ir.notNull = true;
    return ir;
  }
  if (node instanceof Owned) {
    const ir: OwnedIR = { kind: "owned", array: node.cardinality === "many" };
    if (node.id) ir.id = node.id;
    if (node.mirrorName) {
      // Mirror: emite o alvo + só os campos LOCAIS (extras); a base é resolvida no sync.
      ir.mirror = node.mirrorName;
      const extras = shapeToIR(node.shape, selfName);
      if (Object.keys(extras).length) ir.shape = extras;
    } else {
      ir.shape = shapeToIR(node.shape, selfName);
    }
    if (node.options.table !== undefined) ir.table = node.options.table;
    return ir;
  }
  throw new Error("toIR — nó desconhecido no shape (esperado Column/Owned/Reference).");
}
