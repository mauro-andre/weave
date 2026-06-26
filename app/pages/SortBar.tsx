import { useState } from "preact/hooks";
import { Select, type SelectOption } from "../components/Select.js";
import type { FieldIR } from "@mauroandre/weave-core";
import type { SortKey } from "../engine/control-plane/sort.js";
import * as btn from "../styles/button.css.js";
import * as css from "./SortBar.css.js";

type Shapes = Record<string, Record<string, FieldIR>>;

const MANAGED: Record<string, string> = { createdAt: "created at", updatedAt: "updated at" };

/**
 * Barra de ordenação multi-chave (espelha o Filter). Drill-down atravessa só
 * galhos SINGLE (object/link) e termina num escalar; coleções/N:N não aparecem
 * (ambíguo p/ ordenar). Campos gerenciados (created/updated at) são chaves.
 */
export function SortBar({
  shapes,
  root,
  active,
  onChange,
}: {
  shapes: Shapes;
  root: string;
  active: SortKey[] | null;
  onChange: (s: SortKey[] | null) => void;
}) {
  const [keys, setKeys] = useState<SortKey[]>(active ?? []);

  const emit = (next: SortKey[]) => {
    setKeys(next);
    onChange(next.length === 0 ? null : next);
  };
  const add = (k: SortKey) => emit([...keys, k]);
  const remove = (i: number) => emit(keys.filter((_, j) => j !== i));
  const flip = (i: number) =>
    emit(keys.map((k, j) => (j === i ? { ...k, dir: k.dir === "asc" ? "desc" : "asc" } : k)));

  return (
    <div class={css.bar}>
      <div class={css.head}>
        <span class={css.label}>Sort</span>
        <span class={css.spacer} />
        {keys.length > 0 ? (
          <button class={btn.ghost} onClick={() => emit([])}>
            Clear all
          </button>
        ) : null}
      </div>

      {keys.map((k, i) => (
        <div class={css.row} key={i}>
          {keys.length > 1 ? <span class={css.ordinal}>{i + 1}</span> : null}
          <KeyPath shapes={shapes} root={root} path={k.path} />
          <button class={css.dir} onClick={() => flip(i)}>
            {k.dir === "desc" ? "▼ desc" : "▲ asc"}
          </button>
          <button class={css.remove} onClick={() => remove(i)} title="remove sort key">
            ✕
          </button>
        </div>
      ))}

      <SortBuilder shapes={shapes} root={root} onAdd={add} />
    </div>
  );
}

// Caminho de uma chave (read-only).
function KeyPath({ shapes, root, path }: { shapes: Shapes; root: string; path: string[] }) {
  const chosen = resolve(shapes, root, path).chosen;
  return (
    <>
      {chosen.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span class={css.sep}>›&nbsp;</span> : null}
          <span class={css.chip}>
            {c.label}
            <span class={`${css.chipBadge} ${badgeClass(c.kind)}`}>{c.hint}</span>
          </span>
        </span>
      ))}
    </>
  );
}

// Drill-down: ao escolher um escalar (ou managed), vira chave (asc) na hora.
function SortBuilder({ shapes, root, onAdd }: { shapes: Shapes; root: string; onAdd: (k: SortKey) => void }) {
  const [segments, setSegments] = useState<string[]>([]);
  const { chosen, nextFields } = resolve(shapes, root, segments);

  const pick = (name: string) => {
    const node = nextFields[name];
    const segs = [...segments, name];
    if (!node || node.kind === "column") {
      // escalar ou gerenciado → vira chave e reseta
      onAdd({ path: segs, dir: "asc" });
      setSegments([]);
    } else {
      setSegments(segs); // galho single → aprofunda
    }
  };
  const truncate = (i: number) => setSegments(segments.slice(0, i));

  return (
    <div class={css.row}>
      {chosen.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span class={css.sep}>›&nbsp;</span> : null}
          <button class={`${css.chip} ${css.chipBtn}`} onClick={() => truncate(i)} title="edit from here">
            {c.label}
            <span class={`${css.chipBadge} ${badgeClass(c.kind)}`}>{c.hint}</span>
          </button>
        </span>
      ))}
      <Select
        options={sortOptions(nextFields)}
        value=""
        onChange={pick}
        placeholder={chosen.length === 0 ? "by…" : "field…"}
        mono
      />
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
type Crumb = { label: string; kind: "link" | "owned" | "leaf"; hint: string };

function resolve(shapes: Shapes, root: string, segments: string[]): { chosen: Crumb[]; nextFields: Record<string, FieldIR> } {
  const chosen: Crumb[] = [];
  let fields = shapes[root] ?? {};
  for (const name of segments) {
    const node = fields[name];
    if (!node) {
      if (MANAGED[name]) chosen.push({ label: MANAGED[name]!, kind: "leaf", hint: "managed" });
      fields = {};
      break;
    }
    chosen.push(crumb(name, node));
    if (node.kind === "column") {
      fields = {};
      break;
    }
    fields = node.kind === "owned" ? (node.shape ?? {}) : (shapes[node.target] ?? {});
  }
  return { chosen, nextFields: fields };
}

function crumb(name: string, node: FieldIR): Crumb {
  if (node.kind === "reference") return { label: name, kind: "link", hint: "link" };
  if (node.kind === "owned") return { label: name, kind: "owned", hint: "object" };
  return { label: name, kind: "leaf", hint: node.array ? `${node.type}[]` : node.type };
}

function badgeClass(kind: "link" | "owned" | "leaf"): string {
  return kind === "link" ? css.linkBadge : kind === "owned" ? css.ownedBadge : css.leafBadge;
}

// Só escalares não-array (folhas) + galhos SINGLE (object/link) + managed.
function sortOptions(fields: Record<string, FieldIR>): SelectOption[] {
  const opts: SelectOption[] = [];
  for (const [name, node] of Object.entries(fields)) {
    if (node.kind === "column") {
      if (!node.array) opts.push({ value: name, label: name, hint: node.type });
    } else if (node.kind === "owned") {
      if (!node.array) opts.push({ value: name, label: name, hint: "object" });
    } else if (node.cardinality === "one") {
      opts.push({ value: name, label: name, hint: "link" });
    }
  }
  for (const [key, lbl] of Object.entries(MANAGED)) opts.push({ value: key, label: lbl, hint: "managed" });
  return opts;
}
