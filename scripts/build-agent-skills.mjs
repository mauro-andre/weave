#!/usr/bin/env node
/**
 * site/docs/*.md → packages/sdk/agent/skills/<name>/SKILL.md
 *
 * O payload de agente que viaja no pacote npm. O `agent-sync` (do lado do consumidor)
 * varre `node_modules/<pkg>/agent/` SEM saber que pacotes existem, então a FORMA é o
 * contrato — idêntica no VeloJS:
 *
 *   <pkg>/agent/
 *     AGENTS.md              (fonte, commitado)
 *     skills/<name>/SKILL.md (gerado por este script)
 *
 * O `name` é DERIVADO do filename (`02-entities.md` → `weave-entities`), nunca escrito
 * à mão: os dois harnesses exigem que o `name` do frontmatter case com o nome do
 * diretório, e derivar é a única forma de isso não poder divergir. Do frontmatter do doc
 * vem só a `description` — as duas chaves, e mais nenhuma (o opencode descarta o resto
 * sem avisar, então emitir a mais é lixo silencioso).
 *
 * Roda no `prepack` do SDK: vale pro `npm publish` E pro `npm pack`, então o tarball não
 * tem como sair sem as skills — nem se alguém pular o `build`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "site", "docs");
const OUT = path.join(ROOT, "packages", "sdk", "agent", "skills");
const PREFIX = "weave";

/** Idêntico ao parser do site (site/plugins/vite-docs.ts) — subset `key: value`. */
function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

/** `02-entities.md` → `weave-entities`. O prefixo evita colidir com a skill de outro pacote. */
const skillName = (filename) => `${PREFIX}-${filename.replace(/^\d+-/, "").replace(/\.md$/, "")}`;

const files = (await fs.readdir(DOCS)).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) throw new Error(`build-agent-skills: nenhum .md em ${DOCS}`);

// Limpa e reconstrói: uma skill removida do site tem que sumir do pacote, senão o
// consumidor recebe doc de um assunto que não existe mais.
await fs.rm(OUT, { recursive: true, force: true });

const built = [];
for (const file of files) {
  const raw = await fs.readFile(path.join(DOCS, file), "utf-8");
  const { data, body } = parseFrontmatter(raw);
  const name = skillName(file);
  if (!data.description) {
    throw new Error(
      `build-agent-skills: ${file} não tem 'description' no frontmatter. ` +
        `É ela que decide se a skill carrega — sem ela a skill é invisível pro modelo.`,
    );
  }
  if (data.description.includes('"')) {
    throw new Error(`build-agent-skills: a description de ${file} tem aspas duplas — quebraria o YAML.`);
  }
  const dir = path.join(OUT, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${data.description}"\n---\n${body}`,
  );
  built.push(name);
}

console.log(`✓ agent/skills: ${built.length} skills → ${built.join(", ")}`);
