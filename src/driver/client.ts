/**
 * Driver + connection (Phase 1c).
 *
 * `weave()` builds a {@link Weave} instance around a postgres.js client and a
 * set of registered entities. It exposes:
 *
 *   - `sql`         — the raw postgres.js handle (escape hatch).
 *   - `transaction` — run work inside a single ACID transaction.
 *   - `sync()`      — the embryo of the eventual diff-based migrator: creates
 *                     tables that don't exist yet. It does NOT alter existing
 *                     tables (no ADD COLUMN / ADD INDEX) — that's the real diff,
 *                     Phase 6. A transaction-scoped advisory lock serializes
 *                     concurrent boots (multi-instance safe).
 */

import process from "node:process";
import postgres from "postgres";
import { emitCreateTable, emitIndexes } from "../ddl/emit.js";
import type { Entity, ShapeRecord } from "../schema/entity.js";

type Sql = postgres.Sql;
type TransactionSql = postgres.TransactionSql;
type AnyEntity = Entity<string, ShapeRecord>;

/** Arbitrary constant keying the advisory lock that serializes `sync()`. */
const SYNC_LOCK_KEY = 0x7ea7e_0001;

export interface WeaveOptions {
  /** Connection string. Falls back to `process.env.DATABASE_URL`. */
  url?: string;
  /** An existing postgres.js client to reuse instead of creating one. */
  client?: Sql;
  /** Entities to manage. Keys are labels; values are `defineEntity(...)` results. */
  entities?: Record<string, AnyEntity>;
}

/** Outcome of a {@link Weave.sync} call. */
export interface SyncResult {
  /** Tables created this run. */
  created: string[];
  /** Tables that already existed and were left untouched. */
  skipped: string[];
}

export class Weave {
  /** Raw postgres.js handle. Escape hatch for advanced/internal use. */
  readonly sql: Sql;
  private readonly entities: AnyEntity[];
  /** Whether this instance created `sql` (and so should close it). */
  private readonly ownsClient: boolean;

  constructor(options: WeaveOptions = {}) {
    if (options.client) {
      this.sql = options.client;
      this.ownsClient = false;
    } else {
      const url = options.url ?? process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          "weave: no connection. Pass `url`, `client`, or set DATABASE_URL.",
        );
      }
      this.sql = postgres(url);
      this.ownsClient = true;
    }
    this.entities = options.entities ? Object.values(options.entities) : [];
  }

  /** Run `fn` inside a single transaction; commits on resolve, rolls back on throw. */
  transaction<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(fn) as Promise<T>;
  }

  /**
   * Create any registered table that doesn't exist yet, in one transaction.
   * Idempotent: existing tables are skipped (not altered). See class note.
   */
  async sync(): Promise<SyncResult> {
    const created: string[] = [];
    const skipped: string[] = [];

    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;

      const rows = await tx<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public'
      `;
      const existing = new Set(rows.map((r) => r.table_name));

      for (const entity of this.entities) {
        if (existing.has(entity.name)) {
          skipped.push(entity.name);
          continue;
        }
        await tx.unsafe(emitCreateTable(entity));
        for (const idx of emitIndexes(entity)) {
          await tx.unsafe(idx);
        }
        created.push(entity.name);
      }
    });

    return { created, skipped };
  }

  /** Close the underlying connection (only if this instance created it). */
  async close(): Promise<void> {
    if (this.ownsClient) await this.sql.end();
  }
}

/** Build a {@link Weave} instance. */
export function weave(options?: WeaveOptions): Weave {
  return new Weave(options);
}
