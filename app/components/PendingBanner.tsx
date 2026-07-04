import { useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { EntityDiff } from "@mauroandre/weave-core";
import * as css from "./PendingBanner.css.js";
import * as btn from "../styles/button.css.js";

// Faixa + modal de resolução do PENDING de migração. O pending nasce de um `pushAll`
// que não convergiu (persistido no slot único). O pending vem do LOADER do AdminLayout
// (por prop — renderiza junto na carga, senão a faixa não apareceria); a resolução é uma
// action (confirm/fill → applyProject), e no fim recarrega pra o loader refletir. Só o
// Weave tem essa tela.

// Forma client-safe do pending (espelha control-plane/pending.ts; sem puxar server code).
export interface PendingEntry {
  name: string;
  ir: unknown;
  plan: EntityDiff;
}
export interface Pending {
  createdAt: string;
  source: string;
  entries: PendingEntry[];
}

type Resolve = (args: {
  body: { confirm?: Record<string, string[]>; fill?: Record<string, Record<string, unknown>> };
}) => Promise<{ pending: Pending | null }>;

// ── UI ─────────────────────────────────────────────────────────────────────────
const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);
const coerce = (raw: string, type?: string): unknown =>
  type && NUMERIC.has(type) ? Number(raw) : type === "bool" ? raw === "true" : raw;

const iconFor = (risk: string): { glyph: string; cls: string } =>
  risk === "confirm"
    ? { glyph: "🔴", cls: css.iconConfirm }
    : risk === "needsValue"
      ? { glyph: "🟡", cls: css.iconFill }
      : risk === "blocked"
        ? { glyph: "⛔", cls: css.iconBlocked }
        : { glyph: "🟢", cls: css.iconAuto };

function PendingModal({
  pending,
  resolve,
  onClose,
  onApplied,
}: {
  pending: Pending;
  resolve: Resolve;
  onClose: () => void;
  onApplied: (next: Pending | null) => void;
}) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [fills, setFills] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const key = (e: string, p: string) => `${e}::${p}`;

  const confirms: { e: string; path: string }[] = [];
  const needs: { e: string; path: string; fillType: string | undefined }[] = [];
  let hasBlocked = false;
  for (const entry of pending.entries) {
    for (const c of entry.plan.changes) {
      if (c.risk === "confirm") confirms.push({ e: entry.name, path: c.path });
      else if (c.risk === "needsValue") needs.push({ e: entry.name, path: c.path, fillType: (c as { fillType?: string }).fillType });
      else if (c.risk === "blocked") hasBlocked = true;
    }
  }
  const allConfirmed = confirms.every((c) => confirmed[key(c.e, c.path)]);
  const allFilled = needs.every((c) => (fills[key(c.e, c.path)] ?? "").trim() !== "");
  const canApply = !hasBlocked && allConfirmed && allFilled && !saving;

  const apply = async () => {
    setSaving(true);
    const confirm: Record<string, string[]> = {};
    const fill: Record<string, Record<string, unknown>> = {};
    for (const c of confirms) (confirm[c.e] ??= []).push(c.path);
    for (const c of needs) (fill[c.e] ??= {})[c.path] = coerce(fills[key(c.e, c.path)] ?? "", c.fillType);
    const res = await resolve({ body: { confirm, fill } });
    setSaving(false);
    onApplied(res.pending); // atualiza o signal — a faixa some/atualiza sem reload
  };

  return (
    <div class={css.overlay} onClick={onClose}>
      <div class={css.sheet} onClick={(e) => e.stopPropagation()}>
        <div class={css.head}>
          <h2 class={css.title}>Pending migration</h2>
          <p class={css.sub}>Resolve the destructive changes to release your deploy. Nothing happens until you apply.</p>
        </div>

        <div class={css.body}>
          {pending.entries.map((entry) => (
            <div class={css.entitySec} key={entry.name}>
              <div class={css.entityName}>{entry.name}</div>
              {entry.plan.changes.map((c) => {
                const ic = iconFor(c.risk);
                return (
                  <div class={css.change} key={c.path}>
                    <span class={ic.cls}>{ic.glyph}</span>
                    <span class={css.changeLabel}>{c.op}</span>
                    <span class={css.changePath}>{c.path}</span>
                    {c.risk === "confirm" ? (
                      <label class={css.changeHint}>
                        <input
                          type="checkbox"
                          class={css.checkbox}
                          checked={!!confirmed[key(entry.name, c.path)]}
                          onChange={(ev) =>
                            setConfirmed({ ...confirmed, [key(entry.name, c.path)]: (ev.currentTarget as HTMLInputElement).checked })
                          }
                        />{" "}
                        confirm drop (deletes the data)
                      </label>
                    ) : c.risk === "needsValue" ? (
                      <input
                        class={css.fillInput}
                        placeholder="value for existing rows"
                        value={fills[key(entry.name, c.path)] ?? ""}
                        onInput={(ev) =>
                          setFills({ ...fills, [key(entry.name, c.path)]: (ev.currentTarget as HTMLInputElement).value })
                        }
                      />
                    ) : c.risk === "blocked" ? (
                      <span class={css.changeHint}>can't apply here — revert in code / expand-contract</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div class={css.foot}>
          <button class={btn.ghost} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button class={btn.primary} disabled={!canApply} onClick={apply}>
            {saving ? "Applying…" : "Apply and release the deploy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PendingBanner({ initial, resolve }: { initial: Pending | null; resolve: Resolve }) {
  // O loader semeia o signal; resolver atualiza ele → sem reload da tela.
  const pending = useSignal<Pending | null>(initial);
  const [open, setOpen] = useState(false);

  const p = pending.value;
  if (!p || p.entries.length === 0) return null;
  const n = p.entries.reduce((s, e) => s + e.plan.changes.filter((c) => c.risk !== "auto").length, 0);

  return (
    <>
      <div class={css.banner}>
        <span class={css.bannerIcon}>⚠</span>
        <span>
          Pending migration — {n} {n === 1 ? "change" : "changes"} to review
        </span>
        <span class={css.bannerSub}>· your deploy is waiting</span>
        <button class={css.bannerBtn} onClick={() => setOpen(true)}>
          Resolve →
        </button>
      </div>
      {open ? (
        <PendingModal
          pending={p}
          resolve={resolve}
          onClose={() => setOpen(false)}
          onApplied={(next) => {
            pending.value = next; // reativo: faixa some (null) ou atualiza (parcial)
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
