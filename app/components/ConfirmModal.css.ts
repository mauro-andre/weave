import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const overlay = style({
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
  padding: vars.space.lg,
});

export const modal = style({
  width: "min(420px, 100%)",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "14px",
  boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  padding: vars.space.lg,
});

export const title = style({ margin: 0, fontSize: "17px", fontWeight: 700 });

export const message = style({
  margin: "8px 0 0",
  fontSize: "14px",
  color: vars.color.muted,
  lineHeight: 1.5,
});

export const footer = style({
  display: "flex",
  justifyContent: "flex-end",
  gap: "8px",
  marginTop: vars.space.lg,
});
