import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

// Docs a partir de markdown: lê `docs/*.md` (numerados → ordem/slug/título),
// renderiza com marked + shiki, e expõe dois módulos virtuais que o app consome:
//   virtual:docs-manifest  → lista { slug, title, order, filename, description }
//   virtual:docs-content   → { [slug]: { html, rawMd } }
// Também emite cada .md como asset baixável.
//
// FRONTMATTER: cada doc começa com `---\ndescription: …\n---`. Ele é FONTE ÚNICA — o site
// usa pra `<meta name="description">`, e o build do SDK usa pra gerar o `SKILL.md` de cada
// doc (o payload de agente). Mas ele é INVISÍVEL pro site: o `body` é separado no
// carregamento e TUDO daí pra frente opera sobre o body — html, módulo virtual e o `.md`
// baixável. O YAML só existe no arquivo do repo e no SKILL.md gerado.

export interface DocEntry {
  slug: string;
  title: string;
  order: number;
  filename: string;
  /** Do frontmatter — vai pro <meta name="description">, e pro SKILL.md no build do SDK. */
  description: string;
}

interface DocData extends DocEntry {
  html: string;
  /** O markdown SEM o frontmatter — é ele que é renderizado e emitido. */
  rawMd: string;
}

/**
 * Separa o frontmatter YAML do corpo. Subset deliberado: `key: value` por linha, um nível,
 * sem listas nem aninhamento — é tudo que o payload precisa, e evita uma dependência nova
 * (o site não tem parser de YAML e não vale ganhar um por causa de uma chave).
 * Sem frontmatter → `{ data: {}, body: <o texto inteiro> }`.
 */
export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    // aspas opcionais (a description tem `:` no meio, então quase sempre vem citada)
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

const VIRTUAL_MANIFEST = "virtual:docs-manifest";
const VIRTUAL_CONTENT = "virtual:docs-content";
const RESOLVED_MANIFEST = "\0" + VIRTUAL_MANIFEST;
const RESOLVED_CONTENT = "\0" + VIRTUAL_CONTENT;

export function docsPlugin(): Plugin {
  let docs: DocData[] = [];
  let highlighter: Highlighter;

  async function loadDocs() {
    if (!highlighter) {
      highlighter = await createHighlighter({
        themes: ["one-dark-pro"],
        langs: ["typescript", "tsx", "bash", "json", "dockerfile", "yaml", "html", "css", "sql"],
      });
    }

    const marked = new Marked();
    marked.use({
      renderer: {
        code({ text, lang }) {
          const language = lang || "text";
          try {
            return highlighter.codeToHtml(text, { lang: language, theme: "one-dark-pro" });
          } catch {
            return `<pre><code>${text}</code></pre>`;
          }
        },
        heading({ tokens, depth }) {
          const text = tokens.map((t: any) => t.raw || t.text || "").join("");
          const id = text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
          return `<h${depth} id="${id}">${text}</h${depth}>`;
        },
      },
    });

    const docsDir = path.resolve(process.cwd(), "docs");
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();

    docs = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(docsDir, file), "utf-8");
      // Separa AQUI, uma vez. Daqui pra frente só existe `body` — nenhuma saída do site
      // (html, módulo virtual, .md baixável) pode conter o YAML.
      const { data, body: rawMd } = parseFrontmatter(source);
      const orderMatch = file.match(/^(\d+)-/);
      const order = orderMatch ? parseInt(orderMatch[1], 10) : 99;
      const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
      const titleMatch = rawMd.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : slug;
      const html = await marked.parse(rawMd);
      docs.push({ slug, title, order, filename: file, description: data.description ?? "", html, rawMd });
    }
  }

  return {
    name: "weave-docs",

    async buildStart() {
      await loadDocs();
    },

    configureServer(server) {
      server.watcher.add(path.resolve(process.cwd(), "docs"));
      server.watcher.on("change", async (file) => {
        if (file.includes("/docs/") && file.endsWith(".md")) {
          await loadDocs();
          const mod = server.moduleGraph.getModuleById(RESOLVED_MANIFEST);
          if (mod) server.moduleGraph.invalidateModule(mod);
          const contentMod = server.moduleGraph.getModuleById(RESOLVED_CONTENT);
          if (contentMod) server.moduleGraph.invalidateModule(contentMod);
          server.ws.send({ type: "full-reload" });
        }
      });
    },

    resolveId(id) {
      if (id === VIRTUAL_MANIFEST) return RESOLVED_MANIFEST;
      if (id === VIRTUAL_CONTENT) return RESOLVED_CONTENT;
      return null;
    },

    async load(id) {
      if (docs.length === 0) await loadDocs();

      if (id === RESOLVED_MANIFEST) {
        const manifest: DocEntry[] = docs.map(({ slug, title, order, filename, description }) => ({
          slug, title, order, filename, description,
        }));
        return `export default ${JSON.stringify(manifest)};`;
      }

      if (id === RESOLVED_CONTENT) {
        const content: Record<string, { html: string; rawMd: string }> = {};
        for (const doc of docs) content[doc.slug] = { html: doc.html, rawMd: doc.rawMd };
        return `export default ${JSON.stringify(content)};`;
      }

      return null;
    },

    generateBundle() {
      for (const doc of docs) {
        this.emitFile({ type: "asset", fileName: `docs/${doc.filename}`, source: doc.rawMd });
      }
    },
  };
}
