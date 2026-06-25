import type { ComponentChildren } from "preact";
import * as css from "./Page.css.js";

/**
 * Casca padrão de página: header fixo no topo (fora do scroll) + um único
 * container de conteúdo que rola, com scrollbar personalizada.
 */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <div class={css.page}>
      <header class={css.header}>
        <h1 class={css.title}>{title}</h1>
        {actions ? <div class={css.actions}>{actions}</div> : null}
      </header>
      <div class={css.scroll}>
        <div class={css.inner}>{children}</div>
      </div>
    </div>
  );
}
