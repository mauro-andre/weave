#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverEntities, discoverScopes, type ModuleLoader } from "./discover.js";
import { pushEntities } from "./push.js";
import { pushScopes } from "./scope.js";
import { pullEntities, genProject } from "./gen.js";
import { DEFAULT_DIR, type WeaveConfig } from "./config.js";

// Barrel node-only (`@mauroandre/weave-sdk/cli`): a descoberta usa `node:fs`, então
// fica fora do barrel principal (que é portável p/ browser).
export { discoverEntities, discoverScopes, type ModuleLoader } from "./discover.js";

/** Escreve um arquivo (criando dirs). Injetável pra teste. */
async function defaultWrite(file: string, content: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

/** Apaga uma pasta recursivamente (idempotente). Injetável pra teste. */
async function defaultClean(dir: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.rm(dir, { recursive: true, force: true });
}
import type { FetchLike } from "./client.js";

// CLI `weave`. Comandos: `gen` (server → pasta weave/: entidades com $id, scopes,
// barrels e client — overwrite cego), `push` (código → server, plan/apply em ordem
// de dep), `pull` (legado: só entidades). url/key vêm do ambiente (WEAVE_URL/
// WEAVE_KEY); a pasta de destino do `weave.config.ts` (`dir`, default "weave").
// Flags: --config, --confirm, --fill, --rename. Carrega TS via runtime TS-capaz
// (Node 22.6+ com --experimental-strip-types, ou tsx/jiti).

export interface ParsedArgs {
  command: string;
  config: string;
  confirm: Record<string, string[]>;
  fill: Record<string, Record<string, unknown>>;
  renames: Record<string, Record<string, string>>;
  /** `--no-gen`: após o push, NÃO re-sincroniza os arquivos locais (CI, read-only). */
  noGen: boolean;
}

/** "product.legacy" → ["product", "legacy"]; "product.items.qty" → ["product","items.qty"]. */
function splitEntity(s: string | undefined): [string, string] {
  if (!s) return ["", ""];
  const i = s.indexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: argv[0] ?? "", config: "weave.config.ts", confirm: {}, fill: {}, renames: {}, noGen: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i] ?? out.config;
    else if (a === "--no-gen") out.noGen = true;
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
  /** Escreve arquivo (pull/gen). Default: fs. */
  write?: (file: string, content: string) => Promise<void>;
  /** Apaga pasta (gen, antes de reescrever). Default: fs.rm. */
  clean?: (dir: string) => Promise<void>;
  /** Variáveis de ambiente (WEAVE_URL/WEAVE_KEY). Default: process.env. */
  env?: Record<string, string | undefined>;
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
  const env = deps.env ?? process.env;

  if (!["push", "pull", "gen"].includes(args.command)) {
    log(`Unknown command '${args.command}'. Try: weave push | pull | gen`);
    return 1;
  }

  const url = env["WEAVE_URL"];
  const key = env["WEAVE_KEY"];
  if (!url || !key) {
    log("Set WEAVE_URL and WEAVE_KEY in the environment.");
    return 1;
  }

  // Config é opcional (só `dir`, default "weave"); ausente/ilegível → defaults.
  const configPath = path.resolve(cwd, args.config);
  let config: WeaveConfig = {};
  try {
    config = ((await load(configPath)).default ?? {}) as WeaveConfig;
  } catch {
    /* sem weave.config.ts — usa defaults */
  }
  const dirRel = config.dir ?? DEFAULT_DIR;
  const dir = path.resolve(cwd, dirRel);
  const entitiesDir = path.join(dir, "entities");
  const net = { url, key, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  const write = deps.write ?? defaultWrite;
  const clean = deps.clean ?? defaultClean;

  // Regenera a pasta weave/ a partir do server (overwrite cego). Usado pelo `gen`
  // e ao fim do `push` (re-sincroniza os $id recém-cunhados), salvo `--no-gen`.
  const regen = async (): Promise<void> => {
    const { files, entities, scopes } = await genProject(net);
    await clean(path.join(dir, "entities"));
    await clean(path.join(dir, "scopes"));
    for (const [rel, content] of Object.entries(files)) await write(path.join(dir, rel), content);
    log(`✓ generated ${entities.length} ${entities.length === 1 ? "entity" : "entities"}, ${scopes.length} ${scopes.length === 1 ? "scope" : "scopes"} → ${dirRel}/`);
  };

  // gen: server → pasta weave/ inteira (arquivos com $id, scopes resolvidos, barrels, client).
  if (args.command === "gen") {
    await regen();
    return 0;
  }

  // pull (legado): puxa os IRs remotos → escreve os arquivos de entidade (sem $id).
  if (args.command === "pull") {
    const { files, names } = await pullEntities(net);
    for (const [file, content] of Object.entries(files)) await write(path.join(entitiesDir, file), content);
    log(`✓ pulled ${names.length} ${names.length === 1 ? "entity" : "entities"} → ${dirRel}/entities`);
    return 0;
  }

  // push: tudo vai — entidades primeiro (cunham/fixam ids), depois scopes (resolvem
  // nome→id contra o server), e por fim o gen re-sincroniza os arquivos locais.
  const entities = await discoverEntities(entitiesDir, load);
  if (Object.keys(entities).length === 0) {
    log(`No entities found in ${dirRel}/entities.`);
    return 1;
  }

  const res = await pushEntities(entities, {
    ...net,
    confirm: args.confirm,
    fill: args.fill,
    renames: args.renames,
  });

  for (const n of res.applied) log(`  🟢 ${n}  applied`);
  for (const r of res.review) {
    log(`  ⚠ ${r.name} — needs review:`);
    for (const c of r.plan.changes) log(`      ${riskIcon(c.risk)} ${c.op}  ${c.path}  (${c.risk})`);
  }
  // Mudanças bloqueadas no gate → para aqui; scopes/gen ficam pra quando aplicar.
  if (res.review.length > 0) {
    log("Run again with --confirm / --fill / --rename to apply the gated changes.");
    return 1;
  }
  log(`✓ pushed ${res.applied.length} ${res.applied.length === 1 ? "entity" : "entities"}.`);

  // Scopes (só depois das entidades aplicadas — o push resolve nome→id no server).
  const scopes = await discoverScopes(path.join(dir, "scopes"), load);
  if (Object.keys(scopes).length > 0) {
    const { pushed } = await pushScopes(scopes, net);
    log(`✓ pushed ${pushed.length} ${pushed.length === 1 ? "scope" : "scopes"}.`);
  }

  // Re-sincroniza os arquivos locais (ids recém-cunhados), salvo --no-gen.
  if (!args.noGen) await regen();
  return 0;
}

export async function main(): Promise<void> {
  process.exit(await runCli(process.argv.slice(2)));
}

// Executado direto (bin) → roda o main.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
