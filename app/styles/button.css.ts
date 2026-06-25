import { style } from "@vanilla-extract/css";
import { vars } from "./theme.css.js";

// Sistema de botões compartilhado. Funciona tanto em <button> quanto em <a>
// (Link): reseta borda/decoração e herda a fonte. Use `primary` para a ação
// principal e `ghost` para secundárias (cancelar, editar).
const base = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "8px 15px",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 600,
  fontFamily: "inherit",
  lineHeight: 1.2,
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};

export const primary = style({
  ...base,
  background: vars.color.teal,
  border: "1px solid transparent",
  color: vars.color.bg,
  selectors: {
    "&:hover": { filter: "brightness(1.06)" },
    "&:disabled": { opacity: 0.5, cursor: "not-allowed", filter: "none" },
  },
});

export const ghost = style({
  ...base,
  background: "transparent",
  border: `1px solid ${vars.color.border}`,
  color: vars.color.text,
  selectors: {
    "&:hover": { borderColor: vars.color.muted },
    "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
  },
});

export const danger = style({
  ...base,
  background: vars.color.danger,
  border: "1px solid transparent",
  color: vars.color.bg,
  selectors: {
    "&:hover": { filter: "brightness(1.06)" },
    "&:disabled": { opacity: 0.5, cursor: "not-allowed", filter: "none" },
  },
});
