import { style } from "@vanilla-extract/css";
import { vars } from "./styles/theme.css.js";

export const page = style({
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  padding: "64px 20px",
});

export const shell = style({ width: "100%", maxWidth: "560px" });

// ── Header ──────────────────────────────────────────────────
export const header = style({ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "28px" });
export const brand = style({ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em" });
export const badge = style({
  fontSize: "0.72rem",
  fontWeight: 600,
  color: vars.color.accent,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "999px",
  padding: "3px 10px",
  backgroundColor: vars.color.card,
});

// ── Lists ───────────────────────────────────────────────────
export const lists = style({ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "18px" });
export const listChip = style({
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  fontSize: "0.85rem",
  fontWeight: 500,
  color: vars.color.muted,
  backgroundColor: vars.color.card,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "999px",
  padding: "6px 14px",
  cursor: "pointer",
  transition: "all 0.15s",
  ":hover": { color: vars.color.text },
});
export const listChipActive = style({
  color: vars.color.text,
  borderColor: vars.color.accent,
  boxShadow: `inset 0 0 0 1px ${vars.color.accent}`,
});
export const dot = style({ width: "9px", height: "9px", borderRadius: "50%" });
export const listInput = style({
  fontSize: "0.85rem",
  width: "80px",
  border: `1px dashed ${vars.color.border}`,
  borderRadius: "999px",
  padding: "6px 12px",
  background: "transparent",
  color: vars.color.text,
  outline: "none",
  ":focus": { borderColor: vars.color.accent, borderStyle: "solid" },
});

// ── Add todo ────────────────────────────────────────────────
export const addRow = style({ display: "flex", gap: "10px", marginBottom: "20px" });
export const addInput = style({
  flex: 1,
  fontSize: "1rem",
  padding: "14px 16px",
  borderRadius: vars.radius.md,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.card,
  color: vars.color.text,
  outline: "none",
  transition: "border-color 0.15s",
  ":focus": { borderColor: vars.color.accent },
});
export const addBtn = style({
  fontSize: "0.95rem",
  fontWeight: 600,
  color: vars.color.accentText,
  backgroundColor: vars.color.accent,
  border: "none",
  borderRadius: vars.radius.md,
  padding: "0 22px",
  cursor: "pointer",
  transition: "opacity 0.15s",
  ":disabled": { opacity: 0.5, cursor: "default" },
});

// ── Todo list ───────────────────────────────────────────────
export const todoList = style({ listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" });
export const empty = style({ color: vars.color.muted, fontSize: "0.95rem", textAlign: "center", padding: "32px 0" });
export const todo = style({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "13px 16px",
  borderRadius: vars.radius.md,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.card,
  transition: "border-color 0.15s",
  ":hover": { borderColor: "#d7dce2" },
});
export const check = style({
  flexShrink: 0,
  width: "22px",
  height: "22px",
  borderRadius: "50%",
  border: `2px solid ${vars.color.border}`,
  background: "transparent",
  color: "#fff",
  fontSize: "0.78rem",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 0.15s",
});
export const checkOn = style({ backgroundColor: vars.color.accent, borderColor: vars.color.accent });
export const todoTitle = style({ flex: 1, fontSize: "0.98rem" });
export const todoDone = style({ color: vars.color.muted, textDecoration: "line-through" });
export const todoTag = style({
  fontSize: "0.7rem",
  fontWeight: 600,
  color: "#fff",
  borderRadius: "999px",
  padding: "2px 9px",
  opacity: 0.9,
});
export const del = style({
  flexShrink: 0,
  width: "26px",
  height: "26px",
  borderRadius: vars.radius.sm,
  border: "none",
  background: "transparent",
  color: vars.color.muted,
  fontSize: "1.2rem",
  lineHeight: 1,
  cursor: "pointer",
  transition: "all 0.15s",
  ":hover": { color: vars.color.danger, backgroundColor: "#fdecec" },
});
export const footer = style({ marginTop: "20px", textAlign: "center", fontSize: "0.85rem", color: vars.color.muted });

// ── Setup card ──────────────────────────────────────────────
export const setup = style({
  maxWidth: "460px",
  margin: "0 auto",
  backgroundColor: vars.color.card,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
  padding: "32px",
});
export const setupTitle = style({ fontSize: "1.4rem", fontWeight: 800, marginBottom: "8px" });
export const setupText = style({ color: vars.color.muted, marginBottom: "16px" });
export const setupSteps = style({
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  paddingLeft: "20px",
  fontSize: "0.92rem",
  lineHeight: 1.5,
});
export const setupError = style({
  marginTop: "18px",
  padding: "10px 12px",
  borderRadius: vars.radius.sm,
  backgroundColor: "#fdecec",
  color: vars.color.danger,
  fontSize: "0.82rem",
  fontFamily: "ui-monospace, monospace",
  wordBreak: "break-word",
});
