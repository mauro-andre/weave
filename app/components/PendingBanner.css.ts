import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

const AMBER = "#d29922";

// Faixa de "migração pendente" — chama atenção (âmbar), app-wide, "seu deploy espera".
export const banner = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.md,
  padding: `10px ${vars.space.lg}`,
  background: "rgba(210,153,34,0.10)",
  borderBottom: `1px solid ${AMBER}`,
  fontSize: "13px",
  color: vars.color.text,
});
export const bannerIcon = style({ color: AMBER });
export const bannerSub = style({ color: vars.color.muted });
export const bannerBtn = style({
  marginLeft: "auto",
  padding: "5px 12px",
  borderRadius: "6px",
  border: `1px solid ${AMBER}`,
  background: "transparent",
  color: AMBER,
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  selectors: { "&:hover": { background: "rgba(210,153,34,0.15)" } },
});

// Modal
export const overlay = style({
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: vars.space.lg,
  zIndex: 50,
});
export const sheet = style({
  width: "min(680px, 100%)",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "12px",
  overflow: "hidden",
});
export const head = style({ padding: vars.space.lg, borderBottom: `1px solid ${vars.color.border}` });
export const title = style({ margin: 0, fontSize: "16px", color: vars.color.text });
export const sub = style({ marginTop: "4px", fontSize: "13px", color: vars.color.muted });
export const body = style({ padding: vars.space.lg, overflowY: "auto", display: "flex", flexDirection: "column", gap: vars.space.lg });

export const entitySec = style({});
export const entityName = style({
  fontFamily: vars.font.mono,
  fontSize: "13px",
  color: vars.color.text,
  paddingBottom: "6px",
  borderBottom: `1px solid ${vars.color.border}`,
  marginBottom: vars.space.sm,
});
export const change = style({ display: "flex", alignItems: "center", gap: vars.space.sm, padding: "6px 0", fontSize: "13px" });
export const changeLabel = style({ color: vars.color.text });
export const changePath = style({ fontFamily: vars.font.mono, color: vars.color.text });
export const changeHint = style({ fontSize: "11px", color: vars.color.muted });
export const iconConfirm = style({ color: vars.color.danger });
export const iconFill = style({ color: AMBER });
export const iconBlocked = style({ color: vars.color.muted });
export const iconAuto = style({ color: vars.color.green });
export const fillInput = style({
  padding: "4px 8px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  color: vars.color.text,
  fontSize: "12px",
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});
export const checkbox = style({ cursor: "pointer" });

export const foot = style({
  padding: vars.space.md,
  borderTop: `1px solid ${vars.color.border}`,
  display: "flex",
  justifyContent: "flex-end",
  gap: vars.space.sm,
});
