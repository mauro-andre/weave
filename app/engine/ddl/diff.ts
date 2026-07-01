/**
 * Schema diff (Phase 7).
 *
 * Compares the **desired** schema (from {@link collectTables}) against the
 * **actual** live database (introspected) and produces a {@link ChangeSet}.
 *
 * Scope (the PRD's "honest residual tax"): **additive** changes are emitted
 * (create table, add column, add index); destructive/altering drift (dropped
 * columns, type/nullability changes, columns present only in the DB) is
 * **reported as warnings**, never applied. Renames are indistinguishable from a
 * drop+add in a diff, so they surface as drift too.
 */

import { byName } from "@mauroandre/weave-core";
import {
  renderColumnDef,
  renderCreateTable,
  renderComposites,
  renderIndexStmt,
  renderIndexes,
  type ColumnSpec,
  type IndexSpec,
  type TableSpec,
} from "./emit.js";

/** A column as reported by the live database. */
export interface ActualColumn {
  name: string;
  /** Postgres type name (e.g. `int4`, `text`, `timestamptz`). */
  udtName: string;
  isArray: boolean;
  notNull: boolean;
}

/** A table as reported by the live database. */
export interface ActualTable {
  name: string;
  columns: Map<string, ActualColumn>;
  indexes: Set<string>;
}

/** The live `public` schema, keyed by table name. */
export type ActualSchema = Map<string, ActualTable>;

/** The additive work + drift report from a diff. */
export interface ChangeSet {
  createTables: TableSpec[];
  addColumns: { table: string; column: ColumnSpec }[];
  addIndexes: { table: string; index: IndexSpec }[];
  /** Destructive/altering drift — reported, not applied. */
  warnings: string[];
}

/** The canonical SQL type of an actual column, via the catalog (null if unknown). */
function actualSqlType(col: ActualColumn): string | null {
  const base = byName.get(col.udtName);
  if (!base) return null;
  return col.isArray ? `${base.sqlType}[]` : base.sqlType;
}

/** Diff desired table specs against the live schema (pure). */
export function diffSchema(desired: TableSpec[], actual: ActualSchema): ChangeSet {
  const cs: ChangeSet = { createTables: [], addColumns: [], addIndexes: [], warnings: [] };

  for (const spec of desired) {
    const act = actual.get(spec.name);
    if (!act) {
      cs.createTables.push(spec);
      continue;
    }

    const desiredCols = new Set<string>();
    for (const col of spec.columns) {
      desiredCols.add(col.name);
      const acol = act.columns.get(col.name);
      if (!acol) {
        cs.addColumns.push({ table: spec.name, column: col });
        if (col.notNull && col.default === undefined && !col.primaryKey) {
          cs.warnings.push(
            `${spec.name}.${col.name}: adding a NOT NULL column without a default will fail if the table has rows.`,
          );
        }
        continue;
      }
      // Drift on an existing column — report, don't alter.
      const actualType = actualSqlType(acol);
      if (actualType && actualType !== col.sqlType) {
        cs.warnings.push(
          `${spec.name}.${col.name}: type drift (db: ${actualType}, shape: ${col.sqlType}) — manual migration needed.`,
        );
      }
      if (!col.primaryKey && acol.notNull !== col.notNull) {
        cs.warnings.push(
          `${spec.name}.${col.name}: nullability drift (db notNull=${acol.notNull}, shape notNull=${col.notNull}).`,
        );
      }
    }

    for (const index of spec.indexes) {
      if (!act.indexes.has(index.name)) cs.addIndexes.push({ table: spec.name, index });
    }

    for (const acolName of act.columns.keys()) {
      if (!desiredCols.has(acolName)) {
        cs.warnings.push(
          `${spec.name}.${acolName}: column exists in the database but not in the shape (not dropped).`,
        );
      }
    }
  }

  return cs;
}

/** Render a {@link ChangeSet} into additive SQL statements + the drift warnings. */
export function emitChanges(cs: ChangeSet): { statements: string[]; warnings: string[] } {
  const statements: string[] = [];
  for (const spec of cs.createTables) {
    // Entidade NOVA: os compostos entram no CREATE (tabela vazia, sem portão de risco).
    statements.push(renderCreateTable(spec), ...renderIndexes(spec), ...renderComposites(spec));
  }
  for (const { table, column } of cs.addColumns) {
    statements.push(`ALTER TABLE ${table} ADD COLUMN ${renderColumnDef(column)};`);
  }
  for (const { table, index } of cs.addIndexes) {
    statements.push(renderIndexStmt(table, index));
  }
  return { statements, warnings: cs.warnings };
}
