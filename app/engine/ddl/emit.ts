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
 * Decisions baked in: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — the
 * default is only a fallback; Weave supplies a UUID v7 app-side on every insert
 * (see `util/uuid`) so it works on Postgres 13+. Timestamps are
 * `timestamp with time zone NOT NULL DEFAULT now()`; column names are snake_case.
 */

import { Column, type ColumnConfig, type Entity, type ShapeRecord, Owned, type OwnedShape, Reference, camelToSnake, indexName, ownedChildTable, ownedFkColumn, joinTableName, joinTargetFk, singularize } from "@mauroandre/weave-core";

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
  /** FK to another table's `id`. `cascade` true for owned, false for reference. */
  references?: { table: string; cascade: boolean };
}

/** A single-column (for now) index. */
export interface IndexSpec {
  name: string;
  column: string;
}

/** A materialized table: columns + indexes (+ a composite PK for join tables). */
export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  indexes: IndexSpec[];
  /** Composite primary key (join tables). Normal tables use `id` column-level. */
  primaryKey?: string[];
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
    { name: "id", sqlType: "uuid", notNull: true, primaryKey: true, default: "gen_random_uuid()" },
  ];
  const indexes: IndexSpec[] = [];
  const children: TableSpec[] = [];

  if (parent) {
    columns.push({
      name: parent.fkColumn,
      sqlType: "uuid",
      notNull: true,
      references: { table: parent.table, cascade: true },
    });
    // Auto-index the parent FK (§8): owned reads filter on it, cascade uses it.
    indexes.push({ name: indexName(tableName, parent.fkColumn), column: parent.fkColumn });
  }

  for (const [field, value] of Object.entries(shape)) {
    if (value instanceof Owned) {
      const childTable = ownedChildTable(pathPrefix, camelToSnake(field), value.options.table);
      const fkColumn = ownedFkColumn(pathPrefix);
      children.push(
        ...collect(childTable, childTable, value.shape, { table: tableName, fkColumn }),
      );
    } else if (value instanceof Reference && value.cardinality === "one") {
      // N:1 FK column to an independent table — no cascade, auto-indexed (§8).
      const col = `${camelToSnake(field)}_id`;
      columns.push({
        name: col,
        sqlType: "uuid",
        notNull: value.isNotNull,
        references: { table: value.target.name, cascade: false },
      });
      indexes.push({ name: indexName(tableName, col), column: col });
    } else if (value instanceof Reference) {
      // N:N — a dedicated join table (composite PK, both FKs cascade the link).
      const join = joinTableName(pathPrefix, camelToSnake(field));
      const owningFk = ownedFkColumn(pathPrefix);
      const targetFk = joinTargetFk(camelToSnake(field));
      children.push({
        name: join,
        columns: [
          { name: owningFk, sqlType: "uuid", notNull: true, references: { table: tableName, cascade: true } },
          { name: targetFk, sqlType: "uuid", notNull: true, references: { table: value.target.name, cascade: true } },
        ],
        primaryKey: [owningFk, targetFk],
        // Index the target FK for reverse lookup + cascade-from-target.
        indexes: [{ name: indexName(join, targetFk), column: targetFk }],
      });
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
  if (c.references) {
    parts.push(`REFERENCES ${c.references.table}(id)`);
    if (c.references.cascade) parts.push("ON DELETE CASCADE");
  }
  return parts.join(" ");
}

/** Render the `CREATE TABLE` for a single spec. */
export function renderCreateTable(spec: TableSpec): string {
  const lines = spec.columns.map((c) => `  ${renderColumnSpec(c)}`);
  if (spec.primaryKey) lines.push(`  PRIMARY KEY (${spec.primaryKey.join(", ")})`);
  return `CREATE TABLE ${spec.name} (\n${lines.join(",\n")}\n);`;
}

/** Render a single column definition (for `CREATE TABLE` / `ALTER TABLE ADD COLUMN`). */
export function renderColumnDef(c: ColumnSpec): string {
  return renderColumnSpec(c);
}

/** Render one `CREATE INDEX` statement. */
export function renderIndexStmt(table: string, index: IndexSpec): string {
  return `CREATE INDEX ${index.name} ON ${table} (${index.column});`;
}

/** Render the `CREATE INDEX`es for a single spec. */
export function renderIndexes(spec: TableSpec): string[] {
  return spec.indexes.map((i) => renderIndexStmt(spec.name, i));
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

/**
 * Order specs so a table is created after every table it references (within the
 * set). Self-references are ignored (Postgres allows them in `CREATE TABLE`).
 * On a true multi-table FK cycle, the unresolved specs are appended in their
 * original order (best effort) and the CREATE may fail. Such cycles aren't even
 * constructible today (references are eager), so this is defensive; proper
 * deferred-FK handling is a future item (see the PRD roadmap).
 */
export function planTables(specs: TableSpec[]): TableSpec[] {
  const present = new Set(specs.map((s) => s.name));
  const deps = (s: TableSpec): Set<string> => {
    const out = new Set<string>();
    for (const c of s.columns) {
      const t = c.references?.table;
      if (t && t !== s.name && present.has(t)) out.add(t);
    }
    return out;
  };

  const remaining = [...specs];
  const ordered: TableSpec[] = [];
  const done = new Set<string>();

  while (remaining.length) {
    const i = remaining.findIndex((s) => [...deps(s)].every((d) => done.has(d)));
    if (i === -1) break; // cycle — append the rest as-is below
    const [spec] = remaining.splice(i, 1);
    ordered.push(spec!);
    done.add(spec!.name);
  }
  return [...ordered, ...remaining];
}
