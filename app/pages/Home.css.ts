import { style } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css.js";

export const section = style({ marginBottom: vars.space.lg });

export const sectionHead = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  marginBottom: vars.space.md,
});
export const sectionTitle = style({
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: vars.color.muted,
});
export const sectionLink = style({ fontSize: "13px", color: vars.color.teal });
export const dbName = style({ fontFamily: vars.font.mono, fontSize: "12px", color: vars.color.muted });

// ── Stat tiles (KPI row) — números-manchete, sem gráfico ──────────────────────
export const statRow = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: vars.space.md,
});
export const tile = style({
  padding: vars.space.md,
  background: vars.color.surface,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
});
export const tileNum = style({
  fontFamily: vars.font.mono,
  fontSize: "30px",
  fontWeight: 700,
  lineHeight: 1.05,
  letterSpacing: "-0.02em",
  color: vars.color.text,
});
export const tileLabel = style({ marginTop: "6px", fontSize: "12px", color: vars.color.muted });

// ── Entities: lista de recursos — colunas de métricas alinhadas (objects/fields/size) ──
const entityCols = "minmax(110px, 1.4fr) 104px 68px 84px minmax(64px, 1fr) 14px";

export const entityList = style({ display: "flex", flexDirection: "column", gap: "2px" });

// Header: rótulos das colunas numéricas, alinhados à direita como os valores.
export const entityHead = style({
  display: "grid",
  gridTemplateColumns: entityCols,
  alignItems: "center",
  gap: vars.space.md,
  padding: `2px ${vars.space.md} 8px`,
});
// Header clicável (ordena por aquela coluna). Parece um rótulo, comporta como botão.
export const sortHead = style({
  display: "flex",
  alignItems: "center",
  gap: "3px",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "10px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: vars.color.muted,
  transition: "color .12s ease",
  selectors: { "&:hover": { color: vars.color.text } },
});
export const sortLeft = style({ justifyContent: "flex-start" });
export const sortRight = style({ justifyContent: "flex-end" });
export const sortActive = style({ color: vars.color.text });
export const sortArrow = style({ color: vars.color.teal, fontSize: "9px", lineHeight: 1 });

export const entityRow = style({
  display: "grid",
  gridTemplateColumns: entityCols,
  alignItems: "center",
  gap: vars.space.md,
  padding: `11px ${vars.space.md}`,
  background: vars.color.surface,
  border: "1px solid transparent",
  borderRadius: vars.radius.md,
  transition: "border-color .12s ease, background .12s ease",
  selectors: { "&:hover": { borderColor: vars.color.border, background: "#141c22" } },
});
export const entityName = style({
  fontFamily: vars.font.mono,
  fontSize: "13px",
  color: vars.color.text,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
// Valor numérico de uma coluna: mono, alinhado à direita (escaneável linha a linha).
export const num = style({
  fontFamily: vars.font.mono,
  fontSize: "13px",
  color: vars.color.text,
  textAlign: "right",
  whiteSpace: "nowrap",
});
export const numMuted = style([num, { color: vars.color.muted }]);
export const meta = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  justifySelf: "end",
  fontSize: "11px",
  color: vars.color.muted,
  fontFamily: vars.font.mono,
});
export const tag = style({
  padding: "1px 6px",
  borderRadius: "999px",
  border: `1px solid ${vars.color.border}`,
  color: vars.color.teal,
  fontSize: "10px",
  letterSpacing: "0.02em",
});
export const arrow = style({ color: vars.color.muted, fontSize: "14px", justifySelf: "end" });

// ── Engine room (Postgres) — tom infra, mais recessivo que o overview ─────────
export const engineRow = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: vars.space.md,
});
export const engineTile = style({
  padding: `12px ${vars.space.md}`,
  background: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
});
export const engineVal = style({ fontFamily: vars.font.mono, fontSize: "17px", color: vars.color.text });
export const engineLabel = style({
  marginTop: "4px",
  fontSize: "10px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: vars.color.muted,
});

// ── Empty state (instância nova) ──────────────────────────────────────────────
export const empty = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: vars.space.md,
  padding: `${vars.space.lg} 0`,
  textAlign: "center",
});
export const emptyTitle = style({ fontSize: "16px", color: vars.color.text });
export const emptyText = style({ fontSize: "13px", color: vars.color.muted, maxWidth: "420px", lineHeight: 1.5 });
export const emptyActions = style({ display: "flex", gap: vars.space.sm, flexWrap: "wrap", justifyContent: "center" });
