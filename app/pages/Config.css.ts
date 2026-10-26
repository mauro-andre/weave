import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

// Card "Two-factor authentication" (Settings). Tudo nos tokens do tema — o
// único fundo claro da tela é o do PRÓPRIO SVG do QR (conteúdo da imagem,
// requisito de contraste do formato; a moldura é tokens).

export const card = style({
  padding: "16px",
  borderRadius: "10px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
  maxWidth: "560px",
});

export const head = style({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" });
export const title = style({ fontSize: "15px", fontWeight: 600, margin: 0 });

export const badgeOn = style({
  fontSize: "12px",
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: "99px",
  border: `1px solid ${vars.color.green}`,
  color: vars.color.green,
});
export const badgeOff = style({
  fontSize: "12px",
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: "99px",
  border: `1px solid ${vars.color.border}`,
  color: vars.color.muted,
});

export const hint = style({ margin: "10px 0 0", fontSize: "13px", color: vars.color.muted, lineHeight: 1.5 });
export const note = style({ margin: "14px 0 0", fontSize: "12px", color: vars.color.muted, lineHeight: 1.55 });

export const actions = style({ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" });

export const input = style({
  flex: 1,
  minWidth: "180px",
  padding: "9px 12px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  fontSize: "14px",
  fontFamily: vars.font.mono,
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const error = style({ margin: "10px 0 0", fontSize: "13px", color: vars.color.danger });

// Fase "pending": QR + secret + campo de código.
export const pending = style({
  marginTop: "14px",
  paddingTop: "14px",
  borderTop: `1px solid ${vars.color.border}`,
  display: "flex",
  gap: "16px",
  flexWrap: "wrap",
});

export const qrBox = style({
  padding: "8px",
  borderRadius: "8px",
  border: `1px solid ${vars.color.border}`,
  lineHeight: 0,
  alignSelf: "flex-start",
});
export const qrSvg = style({ display: "block" });

export const pendingInfo = style({ flex: 1, minWidth: "220px", display: "flex", flexDirection: "column", gap: "10px" });
export const mono = style({
  padding: "8px 10px",
  borderRadius: "7px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  fontFamily: vars.font.mono,
  fontSize: "13px",
  color: vars.color.text,
  wordBreak: "break-all",
  margin: 0,
});
export const pendingRow = style({ display: "flex", gap: "8px", flexWrap: "wrap" });

// Fase "recovery": mostra UMA vez.
export const recovery = style({
  marginTop: "14px",
  padding: "14px",
  borderRadius: "10px",
  border: `1px solid ${vars.color.teal}`,
  background: vars.color.bg,
});
export const recoveryTitle = style({ fontSize: "13px", fontWeight: 600, margin: "0 0 4px" });
export const recoveryList = style({
  columns: 2,
  gap: "12px",
  margin: "10px 0",
  padding: 0,
  listStyle: "none",
  fontFamily: vars.font.mono,
  fontSize: "13px",
});
export const recoveryItem = style({ padding: "3px 0", color: vars.color.text });
