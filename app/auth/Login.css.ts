import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const main = style({
  maxWidth: "320px",
  margin: "10vh auto",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});

export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
});

export const input = style({
  padding: vars.space.sm,
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  color: vars.color.text,
  fontSize: "14px",
});

export const button = style({
  padding: vars.space.sm,
  background: vars.color.teal,
  border: "none",
  borderRadius: vars.radius.md,
  color: vars.color.bg,
  fontWeight: 600,
  cursor: "pointer",
});

export const error = style({
  color: vars.color.danger,
  margin: 0,
});
