import { createGlobalTheme, globalStyle } from "@vanilla-extract/css";

// Tema claro e limpo pro app de todos. O accent é o teal do Weave (um aceno).
export const vars = createGlobalTheme(":root", {
  color: {
    bg: "#f5f7f9",
    card: "#ffffff",
    text: "#161b22",
    muted: "#6b7480",
    border: "#e6e9ee",
    accent: "#12B886",
    accentText: "#04140d",
    danger: "#e5484d",
  },
  font: {
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: { sm: "8px", md: "12px", lg: "18px" },
});

globalStyle("*", { margin: 0, padding: 0, boxSizing: "border-box" });
globalStyle("body", {
  fontFamily: vars.font.body,
  backgroundColor: vars.color.bg,
  color: vars.color.text,
  WebkitFontSmoothing: "antialiased",
});
globalStyle("button, input", { fontFamily: "inherit" });
