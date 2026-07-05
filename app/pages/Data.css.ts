import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const picker = style({
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginBottom: vars.space.lg,
});

export const countBadge = style({
  display: "inline-flex",
  alignItems: "baseline",
  gap: "5px",
  padding: "6px 12px",
  borderRadius: "999px",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  fontSize: "13px",
  color: vars.color.muted,
});

export const countNum = style({
  fontFamily: vars.font.mono,
  fontWeight: 700,
  fontSize: "14px",
  color: vars.color.text,
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
// pre-wrap: respeita as quebras de linha do texto no modo leitura (e ainda quebra linha longa).
export const valueStr = style({ fontSize: "13px", color: vars.color.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere" });

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

// Editor de coluna textual (text/varchar/bpchar): textarea multilinha (aceita \n). Começa
// com UMA linha e auto-cresce conforme as quebras (altura via JS = scrollHeight) — nunca
// vira um campo gigante pra uma linha só. Mesmo visual do editInput.
export const editTextarea = style({
  flex: 1,
  minWidth: "120px",
  padding: "5px 9px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  color: vars.color.text,
  fontSize: "13px",
  lineHeight: 1.5,
  fontFamily: "inherit",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

// ── Editor de jsonb (highlight layered: textarea transparente sobre um <pre> colorido) ──
// As duas camadas COMPARTILHAM métricas idênticas (fonte/tamanho/entrelinha/padding/wrap)
// pra o texto invisível do textarea cair exatamente sobre o texto colorido do <pre>.
const jsonBox = {
  margin: 0,
  padding: "7px 10px",
  fontFamily: vars.font.mono,
  fontSize: "12px",
  lineHeight: 1.55,
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  tabSize: 2,
} as const;

export const jsonEditor = style({
  position: "relative",
  flex: 1,
  minWidth: "160px",
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  background: vars.color.bg,
  selectors: { "&:focus-within": { borderColor: vars.color.teal } },
});
export const jsonInvalid = style({ borderColor: `${vars.color.danger} !important` });

// Bloco read-only (display de um jsonb): JSON indentado + colorido, como um code block.
export const jsonView = style({
  ...jsonBox,
  maxWidth: "100%",
  color: vars.color.text,
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  overflowX: "auto",
});

// <pre> em fluxo: define a altura (cresce com o conteúdo). Texto visível, sem eventos.
export const jsonPre = style({ ...jsonBox, minHeight: "5.5em", color: vars.color.text, pointerEvents: "none" });

// textarea absoluto por cima: texto transparente (só o caret aparece), fundo transparente.
export const jsonArea = style({
  ...jsonBox,
  position: "absolute",
  inset: 0,
  border: "none",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  background: "transparent",
  color: "transparent",
  caretColor: vars.color.text,
});

// Tokens do JSON (paleta estilo GitHub-dark, harmoniza com os fios azul/verde da marca).
export const jKey = style({ color: "#d2a8ff" }); // chaves
export const jStr = style({ color: "#7ee787" }); // strings
export const jNum = style({ color: "#79c0ff" }); // números
export const jKw = style({ color: "#ffa657" }); // true/false/null
export const jPunct = style({ color: vars.color.muted }); // { } [ ] , :

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
