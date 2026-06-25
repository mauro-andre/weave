import { useState } from "preact/hooks";
import type { EntityDiff, FieldChange } from "../engine/ir/diff.js";
import * as css from "./ReviewSheet.css.js";

const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);
function coerce(raw: string, type: string | undefined): unknown {
  if (type && NUMERIC.has(type)) return Number(raw);
  if (type === "bool") return raw === "true";
  return raw;
}

// A folha de revisão: tudo em vocabulário de objeto, zero SQL. Nada é aplicado
// até o usuário confirmar os 🔴 e preencher os 🟡; ⛔ trava o Apply de vez.
export function ReviewSheet({
  plan,
  saving,
  onCancel,
  onApply,
}: {
  plan: EntityDiff;
  saving: boolean;
  onCancel: () => void;
  onApply: (confirm: string[], fill: Record<string, unknown>) => void;
}) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [fills, setFills] = useState<Record<string, string>>({});

  const of = (risk: string) => plan.changes.filter((c) => c.risk === risk);
  const blocked = of("blocked");
  const confirms = of("confirm");
  const needs = of("needsValue");
  const autos = of("auto");

  const allConfirmed = confirms.every((c) => confirmed[c.path]);
  const allFilled = needs.every((c) => (fills[c.path] ?? "").trim() !== "");
  const canApply = blocked.length === 0 && allConfirmed && allFilled && !saving;

  const apply = () => {
    const fill: Record<string, unknown> = {};
    for (const c of needs) fill[c.path] = coerce(fills[c.path] ?? "", c.fillType);
    onApply(
      confirms.map((c) => c.path),
      fill,
    );
  };

  return (
    <div class={css.overlay} onClick={onCancel}>
      <div class={css.sheet} onClick={(e) => e.stopPropagation()}>
        <div class={css.head}>
          <h2 class={css.title}>Review changes · {plan.entity}</h2>
          <p class={css.sub}>Nothing happens until you choose.</p>
        </div>

        <div class={css.body}>
          {blocked.length > 0 ? (
            <section class={css.group}>
              <h3 class={`${css.groupTitle} ${css.blockedTitle}`}>
                ⛔ Blocked — adjust the definition ({blocked.length})
              </h3>
              {blocked.map((c) => (
                <Item key={c.path} change={c} />
              ))}
            </section>
          ) : null}

          {confirms.length > 0 ? (
            <section class={css.group}>
              <h3 class={`${css.groupTitle} ${css.confirmTitle}`}>
                🔴 Deletes data — confirm to allow ({confirms.length})
              </h3>
              {confirms.map((c) => (
                <div key={c.path} class={css.item}>
                  <div class={css.itemTitle}>{c.title}</div>
                  <div class={css.itemDetail}>{c.detail}</div>
                  <label class={css.confirmRow}>
                    <input
                      type="checkbox"
                      checked={!!confirmed[c.path]}
                      onChange={(e) =>
                        setConfirmed({ ...confirmed, [c.path]: (e.currentTarget as HTMLInputElement).checked })
                      }
                    />
                    Yes, delete {c.path} and its data
                  </label>
                </div>
              ))}
            </section>
          ) : null}

          {needs.length > 0 ? (
            <section class={css.group}>
              <h3 class={`${css.groupTitle} ${css.needsTitle}`}>
                🟡 Needs a value — then it applies ({needs.length})
              </h3>
              {needs.map((c) => (
                <div key={c.path} class={css.item}>
                  <div class={css.itemTitle}>{c.title}</div>
                  <div class={css.itemDetail}>{c.detail} Fill the empty records with:</div>
                  <div class={css.fillRow}>
                    <FillInput
                      change={c}
                      value={fills[c.path] ?? ""}
                      onChange={(v) => setFills({ ...fills, [c.path]: v })}
                    />
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {autos.length > 0 ? (
            <section class={css.group}>
              <h3 class={`${css.groupTitle} ${css.autoTitle}`}>🟢 Applies cleanly ({autos.length})</h3>
              {autos.map((c) => (
                <div key={c.path} class={css.autoItem}>
                  {c.title} {c.detail ? <span class={css.autoKept}>· {c.detail}</span> : null}
                </div>
              ))}
            </section>
          ) : null}
        </div>

        <div class={css.foot}>
          <button type="button" class={css.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" class={css.apply} disabled={!canApply} onClick={apply}>
            {saving ? "Applying…" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Item({ change }: { change: FieldChange }) {
  return (
    <div class={css.item}>
      <div class={css.itemTitle}>{change.title}</div>
      <div class={css.itemDetail}>{change.detail}</div>
    </div>
  );
}

function FillInput({
  change,
  value,
  onChange,
}: {
  change: FieldChange;
  value: string;
  onChange: (v: string) => void;
}) {
  if (change.fillType === "bool") {
    return (
      <select class={css.input} value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        <option value="">choose…</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  const numeric = NUMERIC.has(change.fillType ?? "");
  return (
    <input
      class={css.input}
      type={numeric ? "number" : "text"}
      placeholder="value for the empty records"
      value={value}
      onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
    />
  );
}
