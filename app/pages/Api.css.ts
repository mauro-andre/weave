import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const intro = style({ margin: "0 0 16px", fontSize: "14px", color: vars.color.muted, lineHeight: 1.5 });

export const form = style({ display: "flex", gap: "8px", marginBottom: vars.space.md, flexWrap: "wrap" });

export const input = style({
  flex: 1,
  minWidth: "200px",
  padding: "9px 12px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  fontSize: "14px",
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

// Callout "mostra uma vez".
export const callout = style({
  marginBottom: vars.space.md,
  padding: "14px",
  borderRadius: "10px",
  border: `1px solid ${vars.color.teal}`,
  background: "rgba(18, 184, 134, 0.10)",
  fontSize: "14px",
});

export const keyRow = style({ display: "flex", alignItems: "center", gap: "8px", margin: "10px 0" });

export const keyText = style({
  flex: 1,
  padding: "8px 10px",
  borderRadius: "7px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  fontFamily: vars.font.mono,
  fontSize: "13px",
  color: vars.color.text,
  wordBreak: "break-all",
});

export const dismiss = style({
  background: "transparent",
  border: "none",
  color: vars.color.muted,
  fontSize: "12px",
  cursor: "pointer",
  padding: 0,
  selectors: { "&:hover": { color: vars.color.text } },
});

export const list = style({ display: "flex", flexDirection: "column", gap: "8px" });

export const keyCard = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
});

export const keyInfo = style({ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 });
export const name = style({ fontSize: "14px", fontWeight: 600 });
export const prefix = style({ fontFamily: vars.font.mono, fontSize: "12px", color: vars.color.muted });
export const meta = style({ fontSize: "12px", color: vars.color.muted });
export const empty = style({ color: vars.color.muted, fontSize: "14px" });
