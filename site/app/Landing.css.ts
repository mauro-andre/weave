import { style, styleVariants, keyframes, globalStyle } from "@vanilla-extract/css";
import { vars } from "./styles/theme.css.js";

const maxw = "1120px";

export const page = style({ overflowX: "hidden" });

// ── Nav ─────────────────────────────────────────────────────
export const nav = style({
  position: "sticky",
  top: 0,
  zIndex: 100,
  borderBottom: `1px solid ${vars.color.border}`,
  backgroundColor: "rgba(11,15,18,0.72)",
  backdropFilter: "blur(12px)",
});
export const navInner = style({
  maxWidth: maxw,
  margin: "0 auto",
  padding: "14px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
});
export const brand = style({
  display: "inline-flex",
  alignItems: "center",
  gap: "9px",
  fontWeight: 800,
  fontSize: "1.15rem",
  letterSpacing: "-0.01em",
});
export const navLinks = style({ display: "flex", alignItems: "center", gap: "22px" });
export const navLink = style({
  fontSize: "0.9rem",
  color: vars.color.textMuted,
  transition: "color 0.15s",
  ":hover": { color: vars.color.text },
});
export const navGhBtn = style({
  fontSize: "0.9rem",
  fontWeight: 600,
  color: vars.color.text,
  padding: "7px 15px",
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.border}`,
  transition: "all 0.15s",
  ":hover": { borderColor: vars.color.primary, color: vars.color.primary },
});

// ── Hero ────────────────────────────────────────────────────
export const hero = style({ position: "relative", padding: "84px 24px 72px" });

const float = keyframes({
  "0%,100%": { transform: "translate(-50%, 0)" },
  "50%": { transform: "translate(-50%, -22px)" },
});
export const glow = style({
  position: "absolute",
  top: "-120px",
  left: "50%",
  width: "min(900px, 90vw)",
  height: "520px",
  transform: "translateX(-50%)",
  background:
    "radial-gradient(closest-side, rgba(47,111,235,0.20), transparent 70%), radial-gradient(closest-side, rgba(16,185,129,0.16), transparent 70%)",
  backgroundPosition: "30% 30%, 70% 60%",
  backgroundRepeat: "no-repeat",
  filter: "blur(20px)",
  pointerEvents: "none",
  animation: `${float} 9s ease-in-out infinite`,
  zIndex: 0,
});
export const heroGrid = style({
  position: "relative",
  zIndex: 1,
  maxWidth: maxw,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "48px",
  alignItems: "center",
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr", gap: "40px" } },
});
export const heroCopy = style({});
export const eyebrow = style({
  display: "inline-block",
  fontSize: "0.78rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: vars.color.primary,
  padding: "5px 12px",
  borderRadius: "999px",
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.bgCard,
  marginBottom: "22px",
});
export const title = style({
  fontSize: "clamp(2.6rem, 5.4vw, 4rem)",
  fontWeight: 800,
  lineHeight: 1.05,
  letterSpacing: "-0.03em",
});
export const titleAccent = style({
  background: `linear-gradient(110deg, ${vars.color.blue}, ${vars.color.teal} 55%, ${vars.color.green})`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
});
export const lead = style({
  marginTop: "22px",
  fontSize: "1.12rem",
  lineHeight: 1.65,
  color: vars.color.textMuted,
  maxWidth: "30em",
});
export const ctaRow = style({ display: "flex", gap: "14px", flexWrap: "wrap", marginTop: "30px" });
export const ctaPrimary = style({
  display: "inline-flex",
  alignItems: "center",
  fontWeight: 600,
  fontSize: "0.95rem",
  color: "#04140d",
  backgroundColor: vars.color.primary,
  padding: "11px 22px",
  borderRadius: vars.radius.sm,
  transition: "all 0.15s",
  ":hover": { backgroundColor: vars.color.primaryHover, transform: "translateY(-1px)" },
});
export const ctaSecondary = style({
  display: "inline-flex",
  alignItems: "center",
  fontWeight: 600,
  fontSize: "0.95rem",
  color: vars.color.text,
  padding: "11px 22px",
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.border}`,
  transition: "all 0.15s",
  ":hover": { borderColor: vars.color.textMuted },
});
export const installPill = style({
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  marginTop: "26px",
  fontFamily: vars.font.mono,
  fontSize: "0.86rem",
  color: vars.color.text,
  padding: "11px 16px",
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.bgCard,
});
export const installPrompt = style({ color: vars.color.primary, userSelect: "none" });
export const heroCode = style({ minWidth: 0 });

// ── Generic section ─────────────────────────────────────────
export const section = style({ maxWidth: maxw, margin: "0 auto", padding: "72px 24px" });
export const sectionHead = style({ textAlign: "center", maxWidth: "640px", margin: "0 auto 48px" });
export const sectionTitle = style({
  fontSize: "clamp(1.8rem, 3.6vw, 2.4rem)",
  fontWeight: 800,
  letterSpacing: "-0.02em",
});
export const sectionSub = style({
  marginTop: "14px",
  fontSize: "1.05rem",
  color: vars.color.textMuted,
  lineHeight: 1.6,
});

// ── Features ────────────────────────────────────────────────
export const featureGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "20px",
  "@media": {
    "(max-width: 900px)": { gridTemplateColumns: "1fr 1fr" },
    "(max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
});
export const featureCard = style({
  padding: "26px 24px",
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.bgCard,
  transition: "all 0.18s",
  ":hover": { borderColor: "#2a343d", transform: "translateY(-3px)" },
});
export const featureDot = style({
  display: "block",
  width: "11px",
  height: "11px",
  borderRadius: "3px",
  marginBottom: "16px",
});
export const dotColor = styleVariants({
  teal: { backgroundColor: vars.color.teal, boxShadow: `0 0 14px ${vars.color.teal}` },
  green: { backgroundColor: vars.color.green, boxShadow: `0 0 14px ${vars.color.green}` },
  blue: { backgroundColor: vars.color.blue, boxShadow: `0 0 14px ${vars.color.blue}` },
});
export const featureTitle = style({ fontSize: "1.1rem", fontWeight: 700, marginBottom: "8px" });
export const featureBody = style({ fontSize: "0.94rem", color: vars.color.textMuted, lineHeight: 1.65 });

// ── Threads band ────────────────────────────────────────────
export const threads = style({
  textAlign: "center",
  padding: "84px 24px",
  borderTop: `1px solid ${vars.color.border}`,
  borderBottom: `1px solid ${vars.color.border}`,
  backgroundColor: "rgba(255,255,255,0.012)",
});
export const threadsMark = style({ display: "inline-flex", marginBottom: "22px" });
export const threadsTitle = style({ fontSize: "clamp(1.8rem,3.6vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.02em" });
export const threadsBody = style({
  maxWidth: "620px",
  margin: "18px auto 0",
  fontSize: "1.1rem",
  lineHeight: 1.7,
  color: vars.color.textMuted,
});
export const blue = style({ color: vars.color.blue, fontWeight: 600 });
export const green = style({ color: vars.color.green, fontWeight: 600 });
export const teal = style({ color: vars.color.teal, fontWeight: 600 });

// ── Split (entities as code) ────────────────────────────────
export const split = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "48px",
  alignItems: "center",
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr", gap: "32px" } },
});
export const splitCopy = style({});
export const splitCode = style({ minWidth: 0 });
export const inlineCode = style({
  fontFamily: vars.font.mono,
  fontSize: "0.88em",
  color: vars.color.text,
  backgroundColor: vars.color.bg,
  border: `1px solid ${vars.color.border}`,
  borderRadius: "4px",
  padding: "1px 6px",
});

// ── Run cards ───────────────────────────────────────────────
export const runGrid = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "20px",
  "@media": { "(max-width: 760px)": { gridTemplateColumns: "1fr" } },
});
export const runCard = style({
  padding: "28px",
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.bgCard,
});
export const runTitle = style({ fontSize: "1.25rem", fontWeight: 700, marginBottom: "8px" });
export const runBody = style({ fontSize: "0.95rem", color: vars.color.textMuted, lineHeight: 1.6, marginBottom: "20px" });
export const installPillStatic = style({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontFamily: vars.font.mono,
  fontSize: "0.84rem",
  color: vars.color.text,
  padding: "13px 16px",
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.border}`,
  backgroundColor: vars.color.bg,
});
export const runDocsLink = style({
  display: "inline-block",
  marginTop: "18px",
  fontSize: "0.92rem",
  fontWeight: 600,
  color: vars.color.primary,
  ":hover": { textDecoration: "underline" },
});

// ── CTA ─────────────────────────────────────────────────────
export const cta = style({ textAlign: "center", padding: "96px 24px" });
export const ctaTitle = style({ fontSize: "clamp(2rem,4vw,2.8rem)", fontWeight: 800, letterSpacing: "-0.02em" });
export const ctaSub = style({ marginTop: "14px", fontSize: "1.08rem", color: vars.color.textMuted });

// override centering of the shared ctaRow inside the CTA section
globalStyle(`${cta} ${ctaRow}`, { justifyContent: "center" });

// ── Footer ──────────────────────────────────────────────────
export const footer = style({
  maxWidth: maxw,
  margin: "0 auto",
  padding: "32px 24px",
  borderTop: `1px solid ${vars.color.border}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "12px",
});
export const footerNote = style({ fontSize: "0.85rem", color: vars.color.textMuted });
