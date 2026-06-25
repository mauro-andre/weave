import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const shell = style({
  display: "flex",
  height: "100svh",
  overflow: "hidden",
});

export const sidebar = style({
  width: "240px",
  flexShrink: 0,
  background: vars.color.surface,
  borderRight: `1px solid ${vars.color.border}`,
  padding: "16px 12px",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
});

export const brand = style({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "6px 8px",
  fontWeight: 700,
  fontSize: "17px",
  letterSpacing: "0.2px",
});

export const nav = style({
  display: "flex",
  flexDirection: "column",
  gap: "2px",
});

export const navLink = style({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "9px 10px",
  borderRadius: "8px",
  color: vars.color.muted,
  fontSize: "14px",
  cursor: "pointer",
  transition: "background 120ms, color 120ms",
  selectors: {
    "&:hover": { background: vars.color.bg, color: vars.color.text },
  },
});

export const navLinkActive = style({
  background: "rgba(18, 184, 134, 0.12)",
  color: vars.color.teal,
  fontWeight: 600,
});

export const logout = style({
  marginTop: "auto",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "9px 10px",
  borderRadius: "8px",
  background: "transparent",
  border: "none",
  font: "inherit",
  color: vars.color.muted,
  fontSize: "14px",
  cursor: "pointer",
  textAlign: "left",
  selectors: {
    "&:hover": { background: vars.color.bg, color: vars.color.danger },
  },
});

export const content = style({
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
