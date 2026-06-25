import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const overlay = style({
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: vars.space.lg,
});

export const sheet = style({
  width: "min(560px, 100%)",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "14px",
  boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  overflow: "hidden",
});

export const head = style({
  padding: `${vars.space.md} ${vars.space.lg}`,
  borderBottom: `1px solid ${vars.color.border}`,
});

export const title = style({ margin: 0, fontSize: "17px", fontWeight: 700 });
export const sub = style({ margin: "4px 0 0", fontSize: "13px", color: vars.color.muted });

export const body = style({
  padding: vars.space.lg,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
});

export const group = style({ display: "flex", flexDirection: "column", gap: "8px" });

export const groupTitle = style({
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
});
export const blockedTitle = style({ color: vars.color.danger });
export const confirmTitle = style({ color: vars.color.danger });
export const needsTitle = style({ color: "#E0A100" });
export const autoTitle = style({ color: vars.color.green });

export const item = style({
  padding: "10px 12px",
  borderRadius: "9px",
  border: `1px solid ${vars.color.border}`,
  background: vars.color.surface,
});

export const itemTitle = style({ fontSize: "14px", fontWeight: 600 });
export const itemDetail = style({ marginTop: "2px", fontSize: "12px", color: vars.color.muted });

export const confirmRow = style({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "8px",
  fontSize: "13px",
  cursor: "pointer",
});

export const fillRow = style({ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" });

export const input = style({
  flex: 1,
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

export const autoItem = style({ fontSize: "13px", color: vars.color.text });
export const autoKept = style({ color: vars.color.muted });

export const foot = style({
  display: "flex",
  justifyContent: "flex-end",
  gap: "8px",
  padding: `${vars.space.md} ${vars.space.lg}`,
  borderTop: `1px solid ${vars.color.border}`,
});

export const cancel = style({
  padding: "9px 16px",
  background: "transparent",
  border: `1px solid ${vars.color.border}`,
  borderRadius: "8px",
  color: vars.color.text,
  fontSize: "14px",
  cursor: "pointer",
  selectors: { "&:hover": { borderColor: vars.color.muted } },
});

export const apply = style({
  padding: "9px 18px",
  background: vars.color.teal,
  border: "none",
  borderRadius: "8px",
  color: vars.color.bg,
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
  selectors: {
    "&:hover": { filter: "brightness(1.06)" },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
