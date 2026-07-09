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
  renderForeignKey,
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
  /** Colunas que já têm uma constraint de FK no banco (pra não re-adicionar). */
  foreignKeys: Set<string>;
}

/** The live `public` schema, keyed by table name. */
export type ActualSchema = Map<string, ActualTable>;

/** The additive work + drift report from a diff. */
export interface ChangeSet {
  createTables: TableSpec[];
  addColumns: { table: string; column: ColumnSpec }[];
  addIndexes: { table: string; index: IndexSpec }[];
  /**
   * FKs a adicionar (como `ALTER … ADD CONSTRAINT`, emitidas por último). Rastreadas
   * à parte porque uma FK só é adicionável quando os DOIS lados existem — no ciclo
   * mútuo, a FK que aponta pra tabela ainda-não-criada é adiada e reconciliada quando
   * a outra entity é aplicada (a tabela-alvo passa a existir).
   */
  addForeignKeys: { table: string; column: ColumnSpec }[];
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
  const cs: ChangeSet = { createTables: [], addColumns: [], addIndexes: [], addForeignKeys: [], warnings: [] };

  // Uma FK só entra se a tabela-alvo VAI existir ao aplicar: já no banco, ou sendo
  // criada nesta mesma transação. Senão é adiada (reconciliada quando o alvo surgir).
  const creating = new Set(desired.filter((s) => !actual.has(s.name)).map((s) => s.name));
  const willExist = (t: string): boolean => actual.has(t) || creating.has(t);
  const wantFk = (table: string, col: ColumnSpec): void => {
    if (col.references && willExist(col.references.table)) cs.addForeignKeys.push({ table, column: col });
  };

  for (const spec of desired) {
    const act = actual.get(spec.name);
    if (!act) {
      cs.createTables.push(spec);
      for (const col of spec.columns) wantFk(spec.name, col); // FKs da tabela nova
      continue;
    }
    // Tabela existente: reconcilia FKs que faltam (ex.: adiadas num ciclo, agora
    // com o alvo já criado). `foreignKeys` = colunas que já têm constraint.
    for (const col of spec.columns) {
      if (col.references && !act.foreignKeys.has(col.name)) wantFk(spec.name, col);
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
  // FKs por ÚLTIMO: todas as tabelas/colunas já existem, então ordem entre elas some.
  for (const { table, column } of cs.addForeignKeys) {
    const fk = renderForeignKey(table, column);
    if (fk) statements.push(fk);
  }
  return { statements, warnings: cs.warnings };
}
