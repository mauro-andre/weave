import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const bar = style({
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  marginBottom: vars.space.lg,
  padding: "12px 14px",
  borderRadius: "10px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
});

export const head = style({ display: "flex", alignItems: "center", gap: "10px" });

export const label = style({
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: vars.color.muted,
});

export const match = style({ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: vars.color.muted });

export const spacer = style({ flex: 1 });

export const row = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" });

export const sep = style({ color: vars.color.muted, fontSize: "13px" });

export const chip = style({
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  padding: "5px 10px",
  borderRadius: "999px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.bg,
  color: vars.color.text,
  fontFamily: vars.font.mono,
  fontSize: "13px",
});

export const chipBtn = style({ cursor: "pointer", selectors: { "&:hover": { borderColor: vars.color.muted } } });

export const chipBadge = style({
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.3px",
  textTransform: "uppercase",
  fontFamily: vars.font.ui,
});
export const linkBadge = style({ color: vars.color.blue });
export const ownedBadge = style({ color: vars.color.green });
export const leafBadge = style({ color: vars.color.muted });

export const op = style({ fontSize: "13px", color: vars.color.muted });
export const val = style({ fontSize: "13px", color: vars.color.text, fontFamily: vars.font.mono });

export const valueInput = style({
  width: "150px",
  padding: "7px 10px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  fontSize: "13px",
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const remove = style({
  width: "24px",
  height: "24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: "6px",
  color: vars.color.muted,
  fontSize: "12px",
  cursor: "pointer",
  selectors: { "&:hover": { background: vars.color.bg, color: vars.color.danger } },
});
