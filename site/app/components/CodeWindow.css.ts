import { style, globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const wrapper = style({
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: "#11141a",
  overflow: "hidden",
  boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
});

export const titleBar = style({
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "11px 16px",
  borderBottom: `1px solid ${vars.color.border}`,
  backgroundColor: "rgba(255,255,255,0.02)",
});

export const dots = style({ display: "flex", gap: "7px" });

export const dot = style({
  width: "11px",
  height: "11px",
  borderRadius: "50%",
  backgroundColor: "#2b323b",
});

export const filename = style({
  fontFamily: vars.font.mono,
  fontSize: "0.78rem",
  color: vars.color.textMuted,
});

export const body = style({ overflow: "auto" });

globalStyle(`${body} pre.shiki`, {
  margin: 0,
  padding: "20px 22px",
  background: "transparent !important",
  fontSize: "0.85rem",
  lineHeight: 1.7,
  fontFamily: vars.font.mono,
});

globalStyle(`${body} code`, {
  fontFamily: vars.font.mono,
});
