#!/usr/bin/env node
/**
 * Weave CLI (Phase 7) — a thin wrapper over `diff()` / `generate()` / `sync()`.
 *
 *   weave status     show pending additive changes + drift warnings
 *   weave generate   emit the additive migration SQL (--out <file> to write)
 *   weave sync       apply the additive changes to the database
 *
 * Reads a config that default-exports a `Weave` instance (or `{ url, entities }`).
 * Default config path: `weave.config.mjs` (override with `--config <path>`).
 * The config must be importable by Node (`.mjs`/`.js`); TS users export a JS
 * config or run the CLI through a TS loader.
 */

import process from "node:process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Weave } from "./index.js";

export interface CliFlags {
  config?: string;
  out?: string;
}

/** Parse `argv` (after `node weave`) into a command + flags. */
export function parseArgs(argv: string[]): { command: string; flags: CliFlags } {
  const [command = "help", ...rest] = argv;
  const flags: CliFlags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const eq = arg.indexOf("=");
    const key = (eq === -1 ? arg : arg.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? rest[++i] : arg.slice(eq + 1);
    if (key === "config" && value) flags.config = value;
    else if (key === "out" && value) flags.out = value;
  }
  return { command, flags };
}

/** Load a `Weave` instance from a config module that default-exports it. */
export async function loadConfig(configPath: string): Promise<Weave> {
  const resolved = path.resolve(process.cwd(), configPath);
  const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  const exported = mod["default"] ?? mod["weave"] ?? mod["db"];
  if (exported instanceof Weave) return exported;
  if (exported && typeof exported === "object" && "entities" in exported) {
    return new Weave(exported as ConstructorParameters<typeof Weave>[0]);
  }
  throw new Error(
    `weave: '${configPath}' must default-export a Weave instance or { url, entities }.`,
  );
}

const USAGE = [
  "Usage: weave <command> [--config <path>] [--out <file>]",
  "",
  "Commands:",
  "  status     show pending additive changes and drift warnings",
  "  generate   emit additive migration SQL (--out <file> to write it)",
  "  sync       apply additive changes to the database",
].join("\n");

/** Run a command against an instance. `out` receives output lines. Returns an exit code. */
export async function runCommand(
  db: Weave,
  command: string,
  flags: CliFlags,
  out: (line: string) => void,
): Promise<number> {
  switch (command) {
    case "status": {
      const cs = await db.diff();
      const changes =
        cs.createTables.length + cs.addColumns.length + cs.addIndexes.length;
      if (changes === 0) out("Schema is up to date.");
      else {
        out("Pending changes:");
        for (const t of cs.createTables) out(`  + create table ${t.name}`);
        for (const c of cs.addColumns) out(`  + add column ${c.table}.${c.column.name}`);
        for (const i of cs.addIndexes) out(`  + add index ${i.index.name}`);
      }
      for (const w of cs.warnings) out(`  ! ${w}`);
      return 0;
    }
    case "generate": {
      const { sql, warnings } = await db.generate();
      if (flags.out) {
        await writeFile(path.resolve(process.cwd(), flags.out), sql ? `${sql}\n` : "");
        out(sql ? `Wrote migration to ${flags.out}` : "No changes — nothing written.");
      } else {
        out(sql || "-- no changes");
      }
      for (const w of warnings) out(`-- warning: ${w}`);
      return 0;
    }
    case "sync": {
      const r = await db.sync();
      const total = r.created.length + r.columnsAdded.length + r.indexesAdded.length;
      if (total === 0) out("Schema is up to date.");
      else {
        for (const t of r.created) out(`created table ${t}`);
        for (const c of r.columnsAdded) out(`added column ${c}`);
        for (const i of r.indexesAdded) out(`added index ${i}`);
      }
      for (const w of r.warnings) out(`warning: ${w}`);
      return 0;
    }
    default:
      out(USAGE);
      return command === "help" ? 0 : 1;
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help") {
    console.log(USAGE);
    return;
  }
  const db = await loadConfig(flags.config ?? "weave.config.mjs");
  try {
    const code = await runCommand(db, command, flags, (line) => console.log(line));
    process.exitCode = code;
  } finally {
    await db.close();
  }
}

// Run only when invoked as the executable (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
