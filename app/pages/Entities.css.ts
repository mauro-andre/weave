import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

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
