import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: vars.space.lg,
});

export const title = style({
  margin: 0,
  fontSize: "22px",
  fontWeight: 700,
});

export const newBtn = style({
  display: "inline-block",
  padding: "9px 16px",
  background: vars.color.teal,
  borderRadius: "8px",
  color: vars.color.bg,
  fontWeight: 600,
  fontSize: "14px",
  textDecoration: "none",
  selectors: { "&:hover": { filter: "brightness(1.06)" } },
});

export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

export const item = style({
  display: "block",
  padding: "12px 14px",
  borderRadius: "8px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
  color: vars.color.text,
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
  transition: "border-color 120ms",
  selectors: { "&:hover": { borderColor: vars.color.teal } },
});

export const empty = style({
  color: vars.color.muted,
});
