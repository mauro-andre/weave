import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

// Docs a partir de markdown: lê `docs/*.md` (numerados → ordem/slug/título),
// renderiza com marked + shiki, e expõe dois módulos virtuais que o app consome:
//   virtual:docs-manifest  → lista { slug, title, order, filename }
//   virtual:docs-content   → { [slug]: { html, rawMd } }
// Também emite cada .md como asset baixável.

export interface DocEntry {
  slug: string;
  title: string;
  order: number;
  filename: string;
}

interface DocData extends DocEntry {
  html: string;
  rawMd: string;
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
      const rawMd = fs.readFileSync(path.join(docsDir, file), "utf-8");
      const orderMatch = file.match(/^(\d+)-/);
      const order = orderMatch ? parseInt(orderMatch[1], 10) : 99;
      const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
      const titleMatch = rawMd.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : slug;
      const html = await marked.parse(rawMd);
      docs.push({ slug, title, order, filename: file, html, rawMd });
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
        const manifest: DocEntry[] = docs.map(({ slug, title, order, filename }) => ({
          slug, title, order, filename,
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
