/**
 * DDL emitter (Phase 1b, extended for owned in Phase 2a).
 *
 * An entity is flattened into a list of {@link TableSpec}s — the root table plus
 * one dedicated table per owned relationship, recursively. Specs are ordered
 * parent-before-child so they can be applied without deferred constraints.
 *
 * Naming conventions (from the PRD canonical example):
 *   - child table  = `<ownership path>_<field>` (root prefix is the singular
 *                    entity name: `users` → `user` → `user_addresses`).
 *   - parent FK    = `<singular last path segment>_id` (`user_id`, `address_id`).
 *   - FK is auto-indexed and `ON DELETE CASCADE` (§8).
 *
 * Decisions baked in: `id uuid PRIMARY KEY DEFAULT uuidv7()`, timestamps
 * `timestamp with time zone NOT NULL DEFAULT now()`, snake_case column names.
 */

import { Column, type ColumnConfig } from "../schema/column.js";
import type { Entity, ShapeRecord } from "../schema/entity.js";
import { Owned, type OwnedShape } from "../schema/owned.js";
import { camelToSnake, indexName } from "../util/naming.js";
import { lastSegment, singularize } from "../util/inflect.js";

const TIMESTAMP_SQL = "timestamp with time zone";

// ── Intermediate model ───────────────────────────────────────────────────────

/** A single column in a table spec. */
export interface ColumnSpec {
  name: string;
  /** SQL type, including `[]` for arrays. */
  sqlType: string;
  notNull: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  /** Already-rendered SQL default expression (e.g. `0`, `'{}'`, `now()`). */
  default?: string;
  /** FK target table (always references its `id`), with cascade. */
  references?: string;
}

/** A single-column (for now) index. */
export interface IndexSpec {
  name: string;
  column: string;
}

/** A materialized table: columns + indexes. */
export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  indexes: IndexSpec[];
}

// ── Default rendering ────────────────────────────────────────────────────────

/** Render a SQL literal for a column default. */
function renderDefault(value: unknown, isArray: boolean): string {
  if (isArray) {
    if (Array.isArray(value) && value.length === 0) return "'{}'";
    throw new Error(
      "weave: only an empty-array default ('{}') is supported for array columns in v1.",
    );
  }
  switch (typeof value) {
    case "string":
      return `'${value.replace(/'/g, "''")}'`;
    case "number":
    case "bigint":
      return String(value);
    case "boolean":
      return value ? "true" : "false";
    default:
      throw new Error(
        `weave: unsupported default value of type '${typeof value}'. ` +
          "Use string, number, bigint, boolean, or an empty array.",
      );
  }
}

/** Build the {@link ColumnSpec} for one user column. */
function columnSpec(name: string, config: ColumnConfig): ColumnSpec {
  const spec: ColumnSpec = {
    name: camelToSnake(name),
    sqlType: config.isArray ? `${config.pgType.sqlType}[]` : config.pgType.sqlType,
    notNull: config.notNull,
  };
  if (config.hasDefault) spec.default = renderDefault(config.default, config.isArray);
  if (config.unique) spec.unique = true;
  return spec;
}

// ── Tree flattening ──────────────────────────────────────────────────────────

interface ParentLink {
  /** Parent table name (FK target). */
  table: string;
  /** FK column name in this child table. */
  fkColumn: string;
}

/**
 * Flatten a shape into table specs (this table + descendants), parent-first.
 *
 * @param tableName  - the actual table name.
 * @param pathPrefix - ownership-path prefix for naming children (root: singular entity name).
 * @param shape      - the columns/owned for this table.
 * @param parent     - FK link to the immediate parent (absent for the root).
 */
function collect(
  tableName: string,
  pathPrefix: string,
  shape: ShapeRecord | OwnedShape,
  parent: ParentLink | undefined,
): TableSpec[] {
  const columns: ColumnSpec[] = [
    { name: "id", sqlType: "uuid", notNull: true, primaryKey: true, default: "uuidv7()" },
  ];
  const indexes: IndexSpec[] = [];
  const children: TableSpec[] = [];

  if (parent) {
    columns.push({
      name: parent.fkColumn,
      sqlType: "uuid",
      notNull: true,
      references: parent.table,
    });
    // Auto-index the parent FK (§8): owned reads filter on it, cascade uses it.
    indexes.push({ name: indexName(tableName, parent.fkColumn), column: parent.fkColumn });
  }

  for (const [field, value] of Object.entries(shape)) {
    if (value instanceof Owned) {
      const childTable = value.options.table ?? `${pathPrefix}_${camelToSnake(field)}`;
      const fkColumn = `${singularize(lastSegment(pathPrefix))}_id`;
      children.push(
        ...collect(childTable, childTable, value.shape, { table: tableName, fkColumn }),
      );
    } else if (value instanceof Column) {
      const col = columnSpec(field, value.config);
      columns.push(col);
      if (value.config.index) {
        indexes.push({ name: indexName(tableName, col.name), column: col.name });
      }
    }
  }

  columns.push(
    { name: "created_at", sqlType: TIMESTAMP_SQL, notNull: true, default: "now()" },
    { name: "updated_at", sqlType: TIMESTAMP_SQL, notNull: true, default: "now()" },
  );

  return [{ name: tableName, columns, indexes }, ...children];
}

/** Flatten an entity into all its table specs, parent-first. */
export function collectTables(entity: Entity<string, ShapeRecord>): TableSpec[] {
  return collect(entity.name, singularize(entity.name), entity.columns, undefined);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderColumnSpec(c: ColumnSpec): string {
  const parts = [c.name, c.sqlType];
  if (c.primaryKey) parts.push("PRIMARY KEY");
  else if (c.notNull) parts.push("NOT NULL");
  if (c.default !== undefined) parts.push(`DEFAULT ${c.default}`);
  if (c.unique) parts.push("UNIQUE");
  if (c.references) parts.push(`REFERENCES ${c.references}(id) ON DELETE CASCADE`);
  return parts.join(" ");
}

/** Render the `CREATE TABLE` for a single spec. */
export function renderCreateTable(spec: TableSpec): string {
  const body = spec.columns.map((c) => `  ${renderColumnSpec(c)}`).join(",\n");
  return `CREATE TABLE ${spec.name} (\n${body}\n);`;
}

/** Render the `CREATE INDEX`es for a single spec. */
export function renderIndexes(spec: TableSpec): string[] {
  return spec.indexes.map(
    (i) => `CREATE INDEX ${i.name} ON ${spec.name} (${i.column});`,
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Emit the `CREATE TABLE` for an entity's **root** table only. */
export function emitCreateTable(entity: Entity<string, ShapeRecord>): string {
  return renderCreateTable(collectTables(entity)[0]!);
}

/** Emit the `CREATE INDEX`es for an entity's **root** table only. */
export function emitIndexes(entity: Entity<string, ShapeRecord>): string[] {
  return renderIndexes(collectTables(entity)[0]!);
}

/** Emit the full DDL for an entity: every table (root + owned), then indexes. */
export function emitEntity(entity: Entity<string, ShapeRecord>): string {
  return collectTables(entity)
    .flatMap((spec) => [renderCreateTable(spec), ...renderIndexes(spec)])
    .join("\n");
}
