import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const nameField = style({
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  marginBottom: vars.space.md,
});

export const label = style({
  fontSize: "12px",
  color: vars.color.muted,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
});

export const managed = style({
  fontSize: "13px",
  color: vars.color.muted,
  marginBottom: vars.space.lg,
});

export const section = style({
  margin: `0 0 ${vars.space.sm}`,
  fontSize: "13px",
  color: vars.color.muted,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
});

export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

export const field = style({
  position: "relative",
  borderRadius: "10px",
  border: `1px solid ${vars.color.border}`,
  borderLeft: `3px solid ${vars.color.border}`,
  background: vars.color.surface,
  // sem `overflow: hidden` — ele cortaria o tooltip que sai pra cima do card.
  // No hover o card sobe na pilha pra o tooltip ficar acima dos vizinhos.
  selectors: {
    "&:hover": { zIndex: 1 },
  },
});

export const accentScalar = style({ borderLeftColor: vars.color.muted });
export const accentOwned = style({ borderLeftColor: vars.color.green });
export const accentRef = style({ borderLeftColor: vars.color.blue });

export const fieldRow = style({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 12px",
  flexWrap: "wrap",
});

export const nameInput = style({
  padding: "8px 10px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "7px",
  color: vars.color.text,
  fontSize: "14px",
  outline: "none",
  minWidth: "140px",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const select = style({
  padding: "8px 10px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "7px",
  color: vars.color.text,
  fontSize: "13px",
  cursor: "pointer",
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const flags = style({
  display: "flex",
  gap: "4px",
});

export const defaultWrap = style({
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
});

export const defaultTag = style({
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.4px",
  color: vars.color.muted,
  textTransform: "uppercase",
});

export const defaultInput = style({
  width: "110px",
  padding: "8px 10px",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "7px",
  color: vars.color.text,
  fontSize: "13px",
  fontFamily: vars.font.mono,
  outline: "none",
  selectors: { "&:focus": { borderColor: vars.color.teal } },
});

export const chip = style({
  padding: "5px 9px",
  background: "transparent",
  border: `1px solid ${vars.color.border}`,
  borderRadius: "6px",
  color: vars.color.muted,
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.4px",
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.muted } },
});

export const chipOn = style({
  background: "rgba(18, 184, 134, 0.15)",
  borderColor: vars.color.teal,
  color: vars.color.teal,
});

export const chipWrap = style({
  position: "relative",
  display: "inline-flex",
});

export const tooltip = style({
  position: "absolute",
  bottom: "calc(100% + 7px)",
  left: "50%",
  whiteSpace: "nowrap",
  padding: "5px 8px",
  borderRadius: "6px",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  color: vars.color.text,
  fontSize: "11px",
  fontWeight: 500,
  lineHeight: 1,
  pointerEvents: "none",
  opacity: 0,
  transform: "translateX(-50%) translateY(3px)",
  transition: "opacity 120ms ease, transform 120ms ease",
  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
  zIndex: 10,
  selectors: {
    [`${chipWrap}:hover &`]: {
      opacity: 1,
      transform: "translateX(-50%) translateY(0)",
    },
    "&::after": {
      content: '""',
      position: "absolute",
      top: "100%",
      left: "50%",
      marginLeft: "-4px",
      borderWidth: "4px",
      borderStyle: "solid",
      borderColor: `${vars.color.surface} transparent transparent transparent`,
    },
  },
});

export const remove = style({
  marginLeft: "auto",
  width: "28px",
  height: "28px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: "6px",
  color: vars.color.muted,
  fontSize: "13px",
  cursor: "pointer",
  selectors: { "&:hover": { background: vars.color.bg, color: vars.color.danger } },
});

export const nested = style({
  margin: "0 12px 12px 12px",
  padding: "10px",
  borderRadius: "8px",
  background: vars.color.bg,
  border: `1px dashed ${vars.color.border}`,
});

export const add = style({
  alignSelf: "flex-start",
  padding: "8px 12px",
  background: "transparent",
  border: `1px dashed ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.muted,
  fontSize: "13px",
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.teal, color: vars.color.teal } },
});

export const preview = style({
  marginTop: vars.space.lg,
  padding: "12px 14px",
  borderRadius: "8px",
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  fontSize: "13px",
});

export const previewLabel = style({
  color: vars.color.muted,
});

export const table = style({
  color: vars.color.teal,
  fontFamily: vars.font.mono,
  fontSize: "13px",
});

export const error = style({
  marginTop: vars.space.md,
  color: vars.color.danger,
  fontSize: "13px",
});

export const mirrorNote = style({
  margin: "0 0 8px",
  fontSize: "12px",
  color: vars.color.muted,
});

export const mirrorList = style({
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontSize: "13px",
});

export const mirrorKind = style({
  color: vars.color.muted,
  fontFamily: vars.font.mono,
  fontSize: "12px",
});

export const localLabel = style({
  margin: `${vars.space.sm} 0 6px`,
  paddingTop: vars.space.sm,
  borderTop: `1px dashed ${vars.color.border}`,
  fontSize: "12px",
  color: vars.color.green,
  fontWeight: 600,
});
