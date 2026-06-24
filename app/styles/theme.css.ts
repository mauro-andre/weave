import { createGlobalTheme, globalStyle } from "@vanilla-extract/css";

// Identidade visual (§7.1): dois fios (azul PG + verde Mongo) + teal-assinatura, dark-first.
export const vars = createGlobalTheme(":root", {
  color: {
    bg: "#0B0F12",
    surface: "#11181C",
    border: "#1b2227",
    text: "#e6edf3",
    muted: "#8b949e",
    teal: "#12B886", // assinatura (entrelace)
    blue: "#2F6FEB", // fio relacional / Postgres
    green: "#10B981", // fio objeto / Mongo
    danger: "#e5484d",
  },
  font: {
    ui: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  space: {
    sm: "8px",
    md: "16px",
    lg: "24px",
  },
  radius: {
    md: "8px",
  },
});

globalStyle("html, body", {
  margin: 0,
  background: vars.color.bg,
  color: vars.color.text,
  fontFamily: vars.font.ui,
});

globalStyle("a", {
  color: vars.color.teal,
  textDecoration: "none",
});
