import { Column } from "../schema/column.js";
import { Owned, type OwnedShape } from "../schema/owned.js";
import { Reference } from "../schema/reference.js";
import { catalog } from "../types/registry.js";
import type { Entity, ShapeRecord } from "../schema/entity.js";
import type { PgType } from "../types/pg-type.js";
import type { EntityIR, FieldIR } from "./types.js";

type AnyEntity = Entity<string, ShapeRecord>;
const CATALOG = catalog as unknown as Record<string, PgType>;

/**
 * Reconstrói as estruturas do engine a partir do IR (caminho de volta do
 * serializador). Opera no **conjunto** de entidades porque `reference` resolve o
 * alvo por nome: 1ª passada cria os shells, 2ª monta as shapes ligando as refs.
 */
export function fromIR(irs: EntityIR[]): Record<string, AnyEntity> {
  const map: Record<string, AnyEntity> = {};
  for (const ir of irs) {
    map[ir.name] = { name: ir.name, columns: {} as ShapeRecord };
  }
  for (const ir of irs) {
    (map[ir.name] as { columns: ShapeRecord }).columns = buildShape(ir.fields, map) as unknown as ShapeRecord;
  }
  return map;
}

function buildShape(fields: Record<string, FieldIR>, map: Record<string, AnyEntity>): OwnedShape {
  const shape: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(fields)) {
    shape[key] = buildNode(node, map);
  }
  return shape as OwnedShape;
}

function buildNode(node: FieldIR, map: Record<string, AnyEntity>) {
  if (node.kind === "column") {
    return new Column<unknown, boolean, boolean>({
      pgType: CATALOG[node.type]!,
      isArray: node.array ?? false,
      notNull: node.notNull ?? false,
      hasDefault: node.default !== undefined,
      ...(node.default !== undefined ? { default: node.default } : {}),
      unique: node.unique ?? false,
      index: node.index ?? false,
    });
  }
  if (node.kind === "reference") {
    const target = map[node.target];
    if (!target) throw new Error(`IR — reference to unknown entity: '${node.target}'.`);
    return new Reference(target, node.cardinality, node.notNull ?? false);
  }
  return new Owned(
    buildShape(node.shape, map),
    node.array ? "many" : "one",
    node.table !== undefined ? { table: node.table } : {},
  );
}
