// Highlighter shiki compartilhado pelos snippets da landing. Roda no SSR/SSG (o
// loader da Landing chama `highlight()`), e o HTML estático viaja pro client.
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["one-dark-pro"],
      langs: ["tsx", "typescript", "bash", "json"],
    });
  }
  return highlighterPromise;
}

export async function highlight(
  code: string,
  lang: "tsx" | "typescript" | "bash" | "json" = "tsx",
): Promise<string> {
  const h = await getHighlighter();
  return h.codeToHtml(code.trim(), { lang, theme: "one-dark-pro" });
}
