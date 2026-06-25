import { style, globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const page = style({
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
});

// Header fixo no topo — fora do container de scroll.
export const header = style({
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "16px 28px",
  borderBottom: `1px solid ${vars.color.border}`,
  background: vars.color.bg,
});

export const title = style({ margin: 0, fontSize: "20px", fontWeight: 700 });

export const actions = style({ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 });

// Único container que rola — com scrollbar personalizada.
export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarWidth: "thin",
  scrollbarColor: `${vars.color.border} transparent`,
});

export const inner = style({ maxWidth: "940px", margin: "0 auto", padding: "24px 28px" });

// Scrollbar custom (WebKit/Chromium): fina, arredondada, discreta.
globalStyle(`${scroll}::-webkit-scrollbar`, { width: "10px", height: "10px" });
globalStyle(`${scroll}::-webkit-scrollbar-track`, { background: "transparent" });
globalStyle(`${scroll}::-webkit-scrollbar-thumb`, {
  background: vars.color.border,
  borderRadius: "999px",
  border: `2px solid ${vars.color.bg}`,
});
globalStyle(`${scroll}::-webkit-scrollbar-thumb:hover`, { background: vars.color.muted });
