import { Scripts } from "@mauroandre/velojs";

export const Component = ({ children }: { children: preact.ComponentChildren }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Todos — built with Weave</title>
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <Scripts />
    </head>
    <body>{children}</body>
  </html>
);
