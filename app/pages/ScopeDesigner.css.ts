import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const nameField = style({ display: "flex", flexDirection: "column", gap: "6px", marginBottom: vars.space.lg });
export const label = style({
  fontSize: "12px",
  color: vars.color.muted,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
});
export const nameInput = style({
  padding: "9px 12px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  fontSize: "15px",
  fontFamily: vars.font.mono,
  outline: "none",
  maxWidth: "320px",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const addRow = style({ display: "flex", alignItems: "center", gap: "8px", marginBottom: vars.space.md });

export const cards = style({ display: "flex", flexDirection: "column", gap: vars.space.md });

export const card = style({
  borderRadius: "12px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
  padding: "14px 16px",
});

export const cardHead = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "12px",
});
export const entityName = style({ fontSize: "16px", fontWeight: 700, fontFamily: vars.font.mono });
export const remove = style({
  width: "26px",
  height: "26px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: "6px",
  color: vars.color.muted,
  cursor: "pointer",
  selectors: { "&:hover": { background: vars.color.bg, color: vars.color.danger } },
});

export const sect = style({
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: vars.color.muted,
  margin: "14px 0 8px",
});

export const chips = style({ display: "flex", gap: "6px", flexWrap: "wrap" });
export const chip = style({
  padding: "6px 12px",
  borderRadius: "999px",
  border: `1px solid ${vars.color.border}`,
  background: "transparent",
  color: vars.color.muted,
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.muted } },
});
export const chipOn = style({ background: "rgba(18, 184, 134, 0.15)", borderColor: vars.color.teal, color: vars.color.teal });

export const condRow = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "6px" });

export const crumbSep = style({ color: vars.color.muted, fontSize: "13px" });
export const crumb = style({
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
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.muted } },
});
export const crumbBadge = style({
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.3px",
  textTransform: "uppercase",
  fontFamily: vars.font.ui,
  color: vars.color.muted,
});
export const matchRow = style({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "13px", color: vars.color.muted });

export const toggle = style({ display: "inline-flex", border: `1px solid ${vars.color.border}`, borderRadius: "7px", overflow: "hidden" });
export const toggleBtn = style({
  padding: "6px 10px",
  background: "transparent",
  border: "none",
  color: vars.color.muted,
  fontSize: "12px",
  cursor: "pointer",
  selectors: { "&:hover": { color: vars.color.text } },
});
export const toggleOn = style({ background: vars.color.bg, color: vars.color.teal, fontWeight: 600 });

export const input = style({
  width: "160px",
  padding: "7px 10px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "7px",
  color: vars.color.text,
  fontSize: "13px",
  fontFamily: vars.font.mono,
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const fieldChecks = style({ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" });
export const fieldCheck = style({
  padding: "5px 10px",
  borderRadius: "7px",
  border: `1px solid ${vars.color.border}`,
  background: "transparent",
  color: vars.color.muted,
  fontSize: "12px",
  fontFamily: vars.font.mono,
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.muted } },
});
export const fieldCheckOn = style({ background: "rgba(47, 111, 235, 0.15)", borderColor: vars.color.blue, color: vars.color.blue });

export const tree = style({ marginTop: "8px", display: "flex", flexDirection: "column", gap: "2px" });
export const treeRow = style({ display: "flex", alignItems: "center", gap: "6px" });
export const expand = style({
  width: "18px",
  height: "22px",
  background: "transparent",
  border: "none",
  color: vars.color.muted,
  fontSize: "11px",
  cursor: "pointer",
  padding: 0,
});
export const expandSpacer = style({ width: "18px", flexShrink: 0 });
export const treeChildren = style({
  margin: "2px 0 2px 9px",
  paddingLeft: "12px",
  borderLeft: `2px solid ${vars.color.border}`,
  display: "flex",
  flexDirection: "column",
  gap: "2px",
});
export const kindBadge = style({
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.3px",
  textTransform: "uppercase",
  color: vars.color.muted,
});

export const muted = style({ fontSize: "13px", color: vars.color.muted });
export const error = style({ marginTop: vars.space.md, color: vars.color.danger, fontSize: "13px" });
export const addCond = style({
  alignSelf: "flex-start",
  padding: "6px 12px",
  background: "transparent",
  border: `1px dashed ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.muted,
  fontSize: "12px",
  cursor: "pointer",
  marginTop: "4px",
  selectors: { "&:hover": { borderColor: vars.color.teal, color: vars.color.teal } },
});
