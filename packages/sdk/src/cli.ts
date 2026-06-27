import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverSchema, type ModuleLoader } from "./discover.js";
import { pushSchema } from "./push.js";

// Barrel node-only (`@mauroandre/weave-sdk/cli`): a descoberta usa `node:fs`, então
// fica fora do barrel principal (que é portável p/ browser).
export { discoverSchema, type ModuleLoader } from "./discover.js";
import type { WeaveConfig } from "./config.js";
import type { FetchLike } from "./client.js";

// CLI `weave`. Hoje: `weave push` — carrega o weave.config.ts, descobre as entidades
// por pasta (default export), e empurra via pushSchema (plan/apply, ordem de dep).
// Flags: --config, --confirm, --fill, --rename. Carrega TS via runtime TS-capaz
// (Node 22.6+ com --experimental-strip-types, ou tsx/jiti).

export interface ParsedArgs {
  command: string;
  config: string;
  confirm: Record<string, string[]>;
  fill: Record<string, Record<string, unknown>>;
  renames: Record<string, Record<string, string>>;
}

/** "product.legacy" → ["product", "legacy"]; "product.items.qty" → ["product","items.qty"]. */
function splitEntity(s: string | undefined): [string, string] {
  if (!s) return ["", ""];
  const i = s.indexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: argv[0] ?? "", config: "weave.config.ts", confirm: {}, fill: {}, renames: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i] ?? out.config;
    else if (a === "--confirm") {
      const [e, p] = splitEntity(argv[++i]);
      if (e && p) (out.confirm[e] ??= []).push(p);
    } else if (a === "--fill") {
      const [ep, v = ""] = (argv[++i] ?? "").split(/=(.*)/s);
      const [e, p] = splitEntity(ep);
      if (e && p) (out.fill[e] ??= {})[p] = v;
    } else if (a === "--rename") {
      const [ep, to = ""] = (argv[++i] ?? "").split(/=(.*)/s);
      const [e, p] = splitEntity(ep);
      if (e && p && to) (out.renames[e] ??= {})[p] = to;
    }
  }
  return out;
}

export interface CliDeps {
  /** Importador de módulo (config + entidades). Default: dynamic import. */
  load?: ModuleLoader;
  /** Transporte HTTP. Default: globalThis.fetch. */
  fetch?: FetchLike;
  cwd?: string;
  log?: (msg: string) => void;
}

const riskIcon = (r: string): string =>
  r === "auto" ? "🟢" : r === "confirm" ? "🔴" : r === "needsValue" ? "🟡" : "⛔";

/** Roda o CLI. Devolve o exit code (0 ok; 1 erro / precisa de revisão). */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const args = parseArgs(argv);
  const log = deps.log ?? ((m: string) => console.log(m));
  const load: ModuleLoader = deps.load ?? ((p) => import(pathToFileURL(p).href));
  const cwd = deps.cwd ?? process.cwd();

  if (args.command !== "push") {
    log(`Unknown command '${args.command}'. Try: weave push`);
    return 1;
  }

  const configPath = path.resolve(cwd, args.config);
  const config = (await load(configPath)).default as WeaveConfig | undefined;
  if (!config?.url || !config?.key || !config?.entities) {
    log("Invalid weave.config.ts — needs { entities, url, key }.");
    return 1;
  }

  const entitiesDir = path.resolve(path.dirname(configPath), config.entities);
  const schema = await discoverSchema(entitiesDir, load);
  if (Object.keys(schema).length === 0) {
    log(`No entities found in ${config.entities}.`);
    return 1;
  }

  const res = await pushSchema(schema, {
    url: config.url,
    key: config.key,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    confirm: args.confirm,
    fill: args.fill,
    renames: args.renames,
  });

  for (const n of res.applied) log(`  🟢 ${n}  applied`);
  for (const r of res.review) {
    log(`  ⚠ ${r.name} — needs review:`);
    for (const c of r.plan.changes) log(`      ${riskIcon(c.risk)} ${c.op}  ${c.path}  (${c.risk})`);
  }
  if (res.review.length > 0) {
    log("Run again with --confirm / --fill / --rename to apply the gated changes.");
    return 1;
  }
  log(`✓ pushed ${res.applied.length} ${res.applied.length === 1 ? "entity" : "entities"}.`);
  return 0;
}

export async function main(): Promise<void> {
  process.exit(await runCli(process.argv.slice(2)));
}

// Executado direto (bin) → roda o main.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
