export {
  emitCreateTable,
  emitIndexes,
  emitEntity,
  collectTables,
  renderCreateTable,
  renderIndexes,
  renderColumnDef,
  renderForeignKey,
  renderForeignKeys,
  renderIndexStmt,
  type TableSpec,
  type ColumnSpec,
  type IndexSpec,
} from "./emit.js";
export {
  diffSchema,
  emitChanges,
  type ActualSchema,
  type ActualTable,
  type ActualColumn,
  type ChangeSet,
} from "./diff.js";
