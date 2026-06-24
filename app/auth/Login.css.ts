import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const page = style({
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: vars.space.lg,
});

export const card = style({
  width: "100%",
  maxWidth: "320px",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  padding: "28px",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "12px",
  boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
});

export const brand = style({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontWeight: 700,
  fontSize: "22px",
});

export const subtitle = style({
  margin: "0 0 8px",
  color: vars.color.muted,
  fontSize: "13px",
});

export const input = style({
  padding: "10px 12px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  fontSize: "14px",
  outline: "none",
  selectors: {
    "&:focus": { borderColor: vars.color.teal },
  },
});

export const button = style({
  marginTop: "6px",
  padding: "10px 12px",
  background: vars.color.teal,
  border: "none",
  borderRadius: "8px",
  color: vars.color.bg,
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
  selectors: {
    "&:hover": { filter: "brightness(1.06)" },
  },
});

export const error = style({
  margin: 0,
  color: vars.color.danger,
  fontSize: "13px",
});
