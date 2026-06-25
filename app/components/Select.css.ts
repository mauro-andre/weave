import { style, globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const wrap = style({ position: "relative", display: "inline-block" });

export const trigger = style({
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  minWidth: "220px",
  justifyContent: "space-between",
  padding: "8px 12px",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "9px",
  color: vars.color.text,
  fontSize: "14px",
  fontFamily: vars.font.ui,
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.muted } },
});

export const triggerOpen = style({ borderColor: vars.color.teal });
export const mono = style({ fontFamily: vars.font.mono });
export const placeholder = style({ color: vars.color.muted });
export const caret = style({ color: vars.color.muted, fontSize: "11px" });

export const panel = style({
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  zIndex: 30,
  width: "280px",
  maxHeight: "340px",
  display: "flex",
  flexDirection: "column",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "10px",
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
  overflow: "hidden",
});

export const search = style({
  flexShrink: 0,
  padding: "10px 12px",
  background: vars.color.bg,
  border: "none",
  borderBottom: `1px solid ${vars.color.border}`,
  color: vars.color.text,
  fontSize: "13px",
  outline: "none",
});

export const list = style({
  overflowY: "auto",
  padding: "6px",
  scrollbarWidth: "thin",
  scrollbarColor: `${vars.color.border} transparent`,
});

globalStyle(`${list}::-webkit-scrollbar`, { width: "8px" });
globalStyle(`${list}::-webkit-scrollbar-thumb`, {
  background: vars.color.border,
  borderRadius: "999px",
  border: `2px solid ${vars.color.surface}`,
});

export const option = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  background: "transparent",
  border: "none",
  borderRadius: "7px",
  color: vars.color.text,
  fontSize: "13px",
  fontFamily: vars.font.ui,
  cursor: "pointer",
});

export const optionHint = style({
  flexShrink: 0,
  fontSize: "11px",
  fontFamily: vars.font.ui,
  color: vars.color.muted,
});

export const optionActive = style({ background: vars.color.bg });
export const optionSelected = style({ background: "rgba(18, 184, 134, 0.15)", color: vars.color.teal });
export const empty = style({ padding: "14px 12px", color: vars.color.muted, fontSize: "13px" });
