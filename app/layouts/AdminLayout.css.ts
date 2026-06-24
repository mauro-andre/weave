import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const shell = style({
  display: "flex",
  minHeight: "100vh",
});

export const sidebar = style({
  width: "220px",
  padding: vars.space.md,
  borderRight: `1px solid ${vars.color.border}`,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});

export const brand = style({
  color: vars.color.teal,
  fontWeight: 700,
});

export const navList = style({
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
});

export const logout = style({
  marginTop: "auto",
  padding: vars.space.sm,
  background: "transparent",
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  color: vars.color.muted,
  cursor: "pointer",
});

export const content = style({
  flex: 1,
  padding: vars.space.lg,
});
