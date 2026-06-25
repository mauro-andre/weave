import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const picker = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginBottom: vars.space.lg,
});

export const pill = style({
  padding: "7px 14px",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "999px",
  color: vars.color.muted,
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: vars.font.mono,
  selectors: { "&:hover": { borderColor: vars.color.muted, color: vars.color.text } },
});

export const pillOn = style({
  background: "rgba(18, 184, 134, 0.15)",
  borderColor: vars.color.teal,
  color: vars.color.teal,
});

export const list = style({ display: "flex", flexDirection: "column", gap: vars.space.md });

export const empty = style({ color: vars.color.muted, fontSize: "14px", padding: `${vars.space.lg} 0` });

// ── Card de objeto (recursivo) ─────────────────────────────────────────────────
export const card = style({
  borderRadius: "12px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
  padding: "12px 14px",
});

export const cardId = style({
  fontFamily: vars.font.mono,
  fontSize: "11px",
  color: vars.color.muted,
  marginBottom: "8px",
  wordBreak: "break-all",
});

export const row = style({
  display: "flex",
  gap: "12px",
  padding: "4px 0",
  alignItems: "baseline",
});

export const fieldLabel = style({
  minWidth: "120px",
  flexShrink: 0,
  fontSize: "13px",
  color: vars.color.muted,
  fontFamily: vars.font.mono,
});

export const value = style({ fontSize: "13px", color: vars.color.text, wordBreak: "break-word" });
export const valueNull = style({ fontSize: "13px", color: vars.color.muted, fontStyle: "italic" });
export const valueNum = style({ fontSize: "13px", color: vars.color.blue, fontFamily: vars.font.mono });
export const valueBool = style({ fontSize: "13px", color: vars.color.green, fontFamily: vars.font.mono });
export const valueStr = style({ fontSize: "13px", color: vars.color.text });

export const showAll = style({
  marginTop: "6px",
  background: "transparent",
  border: "none",
  color: vars.color.teal,
  fontSize: "12px",
  cursor: "pointer",
  padding: "2px 0",
  selectors: { "&:hover": { textDecoration: "underline" } },
});

// ── Bloco aninhado (owned = coleção; reference = link) ─────────────────────────
export const nested = style({ padding: "4px 0" });

export const nestedHead = style({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  background: "transparent",
  border: "none",
  color: vars.color.text,
  fontSize: "13px",
  cursor: "pointer",
  padding: "4px 0",
  width: "100%",
});

export const chevron = style({ color: vars.color.muted, fontSize: "11px", width: "12px" });
export const nestedName = style({ fontSize: "13px", fontFamily: vars.font.mono, color: vars.color.text });

export const badge = style({
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.4px",
  textTransform: "uppercase",
  padding: "2px 7px",
  borderRadius: "999px",
});
export const badgeOwned = style({ background: "rgba(16, 185, 129, 0.16)", color: vars.color.green });
export const badgeRef = style({ background: "rgba(47, 111, 235, 0.16)", color: vars.color.blue });

export const count = style({ color: vars.color.muted, fontSize: "12px" });

export const children = style({
  margin: "6px 0 6px 16px",
  paddingLeft: "12px",
  borderLeft: `2px solid ${vars.color.border}`,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

// ── Paginação ───────────────────────────────────────────────────────────────
export const pager = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "14px",
  marginTop: vars.space.lg,
  fontSize: "13px",
  color: vars.color.muted,
});

// ── Edição inline ──────────────────────────────────────────────────────────
export const cardHead = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  marginBottom: "8px",
});

export const actions = style({ display: "flex", gap: "6px", flexShrink: 0 });

export const editInput = style({
  flex: 1,
  minWidth: "120px",
  padding: "5px 9px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  color: vars.color.text,
  fontSize: "13px",
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const idInput = style({
  width: "100%",
  marginBottom: "6px",
  padding: "4px 8px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  color: vars.color.muted,
  fontFamily: vars.font.mono,
  fontSize: "11px",
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal, color: vars.color.text } },
});

export const subCard = style({
  position: "relative",
  borderRadius: "10px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.bg,
  padding: "10px 12px",
});

export const addItem = style({
  alignSelf: "flex-start",
  padding: "6px 12px",
  background: "transparent",
  border: `1px dashed ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.muted,
  fontSize: "12px",
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.teal, color: vars.color.teal } },
});

export const removeItem = style({
  position: "absolute",
  top: "8px",
  right: "8px",
  width: "22px",
  height: "22px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: "5px",
  color: vars.color.muted,
  fontSize: "12px",
  cursor: "pointer",
  selectors: { "&:hover": { background: vars.color.surface, color: vars.color.danger } },
});

export const readonlyTag = style({
  fontSize: "10px",
  color: vars.color.muted,
  fontStyle: "italic",
  marginLeft: "4px",
});

export const errorMsg = style({ marginTop: "8px", color: vars.color.danger, fontSize: "13px" });

export const pagerBtn = style({
  width: "32px",
  height: "32px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  cursor: "pointer",
  selectors: {
    "&:hover:not(:disabled)": { borderColor: vars.color.teal },
    "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
  },
});
