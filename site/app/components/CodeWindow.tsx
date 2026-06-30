import type { ComponentChildren } from "preact";
import * as css from "./CodeWindow.css.js";

export interface CodeWindowProps {
  filename?: string;
  /** HTML pré-destacado (do shiki `highlight()`). */
  html?: string;
  children?: ComponentChildren;
  class?: string;
}

/** Moldura estilo editor pros snippets: barra de título + 3 pontos + corpo. */
export function CodeWindow({ filename, html, children, class: className }: CodeWindowProps) {
  return (
    <div class={className ? `${css.wrapper} ${className}` : css.wrapper}>
      <div class={css.titleBar}>
        <div class={css.dots}>
          <span class={css.dot} />
          <span class={css.dot} />
          <span class={css.dot} />
        </div>
        {filename && <span class={css.filename}>{filename}</span>}
      </div>
      <div class={css.body}>
        {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : children}
      </div>
    </div>
  );
}
