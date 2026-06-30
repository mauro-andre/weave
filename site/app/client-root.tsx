import { Scripts } from "@mauroandre/velojs";

interface RootProps {
  children: preact.ComponentChildren;
}

export const Component = ({ children }: RootProps) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Weave — think in objects, never write SQL</title>
        <meta
          name="description"
          content="Weave is a code-first object abstraction over PostgreSQL. Design entities, query by nesting, enforce access as code — the database speaks SQL, you speak objects."
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <Scripts />
      </head>
      <body>{children}</body>
    </html>
  );
};
