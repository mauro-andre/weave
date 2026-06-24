import type { ComponentChildren } from "preact";
import { Scripts } from "@mauroandre/velojs";
import "./styles/theme.css.js";

export const Component = ({ children }: { children?: ComponentChildren }) => (
  <html lang="pt-BR">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Weave</title>
      <Scripts />
    </head>
    <body>{children}</body>
  </html>
);
