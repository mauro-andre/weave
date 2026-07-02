/**
 * Write compiler — `shred` (Phase 2c).
 *
 * Shreds an object into rows and writes the whole `owned` aggregate in one
 * transaction (the caller provides it). Semantics:
 *
 *   - **Root**: upsert by `id` when given (`ON CONFLICT (id) DO UPDATE`),
 *     otherwise plain insert. `updated_at` is bumped on update (app-side).
 *   - **Owned children**: **replace** — delete the parent's existing children,
 *     then insert from the object (ids churn; children are exclusive parts).
 *     Recurses to any depth. Omitting an owned field means "no children".
 *
 * The object is the source of truth: after `shred` the DB matches it exactly.
 * `reference` is not handled here (Phase 3).
 */

import { Column, type Entity, type ShapeRecord, Owned, type OwnedShape, Reference, camelToSnake, ownedChildTable, ownedFkColumn, joinTableName, joinTargetFk, uuidv7 } from "@mauroandre/weave-core";

/** Minimal transactional executor (satisfied by postgres.js `TransactionSql`). */
export interface Executor {
  unsafe(query: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

/** `INSERT ... RETURNING id` for the given columns (or `DEFAULT VALUES` if none). */
export function renderInsert(table: string, columns: string[]): string {
  if (columns.length === 0) {
    return `INSERT INTO ${table} DEFAULT VALUES RETURNING id`;
  }
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`;
}

/**
 * `INSERT ... ON CONFLICT (id) DO UPDATE ... RETURNING id`.
 * `columns[0]` must be `id`; the rest are data columns (also bumps `updated_at`).
 */
export function renderUpsert(table: string, columns: string[]): string {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const dataColumns = columns.slice(1);
  const updates = [
    ...dataColumns.map((c) => `${c} = excluded.${c}`),
    "updated_at = now()",
  ].join(", ");
  return (
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ` +
    `ON CONFLICT (id) DO UPDATE SET ${updates} RETURNING id`
  );
}

interface ParentLink {
  parentId: string;
  fkColumn: string;
}

/** Write one node (and its owned subtree), returning its row id. */
async function writeNode(
  exec: Executor,
  table: string,
  prefix: string,
  shape: ShapeRecord | OwnedShape,
  input: Record<string, unknown>,
  parent: ParentLink | undefined,
): Promise<string> {
  // Generate the id app-side (works on any Postgres; see util/uuid).
  const id = typeof input["id"] === "string" ? input["id"] : uuidv7();
  const columns: string[] = ["id"];
  const values: unknown[] = [id];

  if (parent) {
    columns.push(parent.fkColumn);
    values.push(parent.parentId);
  }
  for (const [field, value] of Object.entries(shape)) {
    if (value instanceof Column && input[field] !== undefined) {
      columns.push(camelToSnake(field));
      values.push(input[field]);
    } else if (value instanceof Reference && value.cardinality === "one") {
      // N:1 — set the FK from `<field>Id`; never touch the target table.
      const fkValue = input[`${field}Id`];
      if (fkValue !== undefined) {
        columns.push(`${camelToSnake(field)}_id`);
        values.push(fkValue);
      }
    }
  }

  // Root with a provided id → upsert (it may already exist); else insert.
  if (!parent && typeof input["id"] === "string") {
    await exec.unsafe(renderUpsert(table, columns), values);
  } else {
    await exec.unsafe(renderInsert(table, columns), values);
  }

  for (const [field, value] of Object.entries(shape)) {
    if (value instanceof Owned) {
      // Owned children: replace (delete then re-insert from the object).
      const childTable = ownedChildTable(prefix, camelToSnake(field), value.options.table);
      const fkColumn = ownedFkColumn(prefix);
      await exec.unsafe(`DELETE FROM ${childTable} WHERE ${fkColumn} = $1`, [id]);

      const raw = input[field];
      const childInputs =
        value.cardinality === "many"
          ? Array.isArray(raw)
            ? raw
            : []
          : raw != null
            ? [raw]
            : [];

      for (const childInput of childInputs) {
        await writeNode(
          exec,
          childTable,
          childTable,
          value.shape,
          childInput as Record<string, unknown>,
          { parentId: id, fkColumn },
        );
      }
    } else if (value instanceof Reference && value.cardinality === "many") {
      // N:N — replace the link set; never touch the target table.
      const join = joinTableName(prefix, camelToSnake(field));
      const owningFk = ownedFkColumn(prefix);
      const targetFk = joinTargetFk(camelToSnake(field));
      await exec.unsafe(`DELETE FROM ${join} WHERE ${owningFk} = $1`, [id]);

      const ids = input[`${field}Ids`];
      if (Array.isArray(ids)) {
        for (const targetId of ids) {
          await exec.unsafe(
            `INSERT INTO ${join} (${owningFk}, ${targetFk}) VALUES ($1, $2)`,
            [id, targetId],
          );
        }
      }
    }
  }

  return id;
}

/** Shred an aggregate into the database, returning the root row id. */
export function shred(
  exec: Executor,
  entity: Entity<string, ShapeRecord>,
  input: Record<string, unknown>,
): Promise<string> {
  return writeNode(exec, entity.name, entity.name, entity.columns, input, undefined);
}
