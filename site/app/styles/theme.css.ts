import { createGlobalTheme, globalStyle } from "@vanilla-extract/css";

// Identidade do Weave: dois fios — azul (relacional/SQL) + verde (objeto) — e o
// teal-assinatura onde eles se entrelaçam. Dark-first.
export const vars = createGlobalTheme(":root", {
  color: {
    bg: "#0B0F12",
    bgCard: "#11181C",
    bgCardHover: "#171f25",
    text: "#e6edf3",
    textMuted: "#8b949e",
    border: "#1b2227",
    primary: "#12B886", // teal — assinatura (o entrelace)
    primaryHover: "#0ea372",
    accent: "#2F6FEB", // azul — fio relacional
    blue: "#2F6FEB", // fio SQL / Postgres
    green: "#10B981", // fio objeto
    teal: "#12B886", // entrelace
  },
  font: {
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  },
  radius: {
    sm: "6px",
    md: "10px",
    lg: "16px",
    xl: "24px",
  },
});

globalStyle("*", { margin: 0, padding: 0, boxSizing: "border-box" });
globalStyle("html", { scrollBehavior: "smooth" });
globalStyle("body", {
  fontFamily: vars.font.body,
  backgroundColor: vars.color.bg,
  color: vars.color.text,
  lineHeight: 1.6,
  WebkitFontSmoothing: "antialiased",
});
globalStyle("a", { color: "inherit", textDecoration: "none" });
