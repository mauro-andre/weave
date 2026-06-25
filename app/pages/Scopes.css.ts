import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const list = style({ display: "flex", flexDirection: "column", gap: "8px" });

export const item = style({
  display: "flex",
  flexDirection: "column",
  gap: "3px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
  color: vars.color.text,
  textDecoration: "none",
  cursor: "pointer",
  transition: "border-color 120ms",
  selectors: { "&:hover": { borderColor: vars.color.teal } },
});

export const name = style({ fontSize: "15px", fontWeight: 600 });
export const meta = style({ fontSize: "12px", color: vars.color.muted, fontFamily: vars.font.mono });
export const empty = style({ color: vars.color.muted, fontSize: "14px" });
