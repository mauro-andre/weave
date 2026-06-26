import { useState } from "preact/hooks";
import { Select, type SelectOption } from "../components/Select.js";
import type { ColumnIR, FieldIR } from "@mauroandre/weave-core";
import type { Condition, Filter } from "../engine/control-plane/filter.js";
import * as btn from "../styles/button.css.js";
import * as css from "./FilterBar.css.js";

type Shapes = Record<string, Record<string, FieldIR>>;

const TEXT = new Set(["text", "varchar", "bpchar"]);
const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);
const DATE = new Set(["timestamptz", "timestamp", "date", "time"]);
const NO_VALUE = new Set(["isEmpty", "isTrue", "isFalse"]);

// Campos gerenciados (não estão no shape, mas existem em toda entidade).
const MANAGED: Record<string, { label: string; type: string }> = {
  id: { label: "id", type: "uuid" },
  createdAt: { label: "created at", type: "timestamptz" },
  updatedAt: { label: "updated at", type: "timestamptz" },
};
function fieldLabel(name: string): string {
  return MANAGED[name]?.label ?? name;
}

const OP_LABEL: Record<string, string> = {
  contains: "contains",
  startsWith: "starts with",
  equals: "equals",
  notEquals: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  before: "before",
  after: "after",
  on: "on",
  isTrue: "is true",
  isFalse: "is false",
  isEmpty: "is empty",
};

/**
 * Barra de filtro multi-condição. A UI monta uma lista plana combinada por
 * `all` (AND) ou `any` (OR), mas o modelo é uma árvore booleana — a API aceita
 * qualquer aninhamento. Cada condição é construída por drill-down sobre as
 * formas resolvidas (owned/reference viram galhos; escalar é a folha).
 */
export function FilterBar({
  shapes,
  root,
  active,
  onChange,
}: {
  shapes: Shapes;
  root: string;
  active: Filter | null;
  onChange: (f: Filter | null) => void;
}) {
  const decoded = decode(active);
  const [match, setMatch] = useState<"all" | "any">(decoded.match);
  const [conditions, setConditions] = useState<Condition[]>(decoded.conditions);

  const emit = (conds: Condition[], m: "all" | "any") => {
    onChange(conds.length === 0 ? null : m === "all" ? { and: conds } : { or: conds });
  };
  const add = (c: Condition) => {
    const next = [...conditions, c];
    setConditions(next);
    emit(next, match);
  };
  const remove = (i: number) => {
    const next = conditions.filter((_, j) => j !== i);
    setConditions(next);
    emit(next, match);
  };
  const changeMatch = (m: "all" | "any") => {
    setMatch(m);
    emit(conditions, m);
  };
  const clearAll = () => {
    setConditions([]);
    onChange(null);
  };

  return (
    <div class={css.bar}>
      <div class={css.head}>
        <span class={css.label}>Filter</span>
        {conditions.length >= 2 ? (
          <span class={css.match}>
            Match
            <Select
              options={[
                { value: "all", label: "all" },
                { value: "any", label: "any" },
              ]}
              value={match}
              onChange={(v) => changeMatch(v as "all" | "any")}
              searchable={false}
            />
          </span>
        ) : null}
        <span class={css.spacer} />
        {conditions.length > 0 ? (
          <button class={btn.ghost} onClick={clearAll}>
            Clear all
          </button>
        ) : null}
      </div>

      {conditions.map((c, i) => (
        <ConditionRow key={i} shapes={shapes} root={root} condition={c} onRemove={() => remove(i)} />
      ))}

      <ConditionBuilder shapes={shapes} root={root} onAdd={add} />
    </div>
  );
}

// ── Linha de condição aplicada (read-only + remover) ──────────────────────────
function ConditionRow({
  shapes,
  root,
  condition,
  onRemove,
}: {
  shapes: Shapes;
  root: string;
  condition: Condition;
  onRemove: () => void;
}) {
  const { chosen, leaf } = resolvePath(shapes, root, condition.path);
  const opText = leaf?.array ? `any ${OP_LABEL[condition.op] ?? condition.op}` : OP_LABEL[condition.op] ?? condition.op;
  return (
    <div class={css.row}>
      {chosen.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span class={css.sep}>›&nbsp;</span> : null}
          <span class={css.chip}>
            {fieldLabel(c.name)}
            <span class={`${css.chipBadge} ${badgeClass(kindOf(c.node))}`}>{kindLabel(c.node)}</span>
          </span>
        </span>
      ))}
      <span class={css.op}>{opText}</span>
      {!NO_VALUE.has(condition.op) && condition.value !== undefined ? (
        <span class={css.val}>"{String(condition.value)}"</span>
      ) : null}
      <button class={css.remove} onClick={onRemove} title="remove condition">
        ✕
      </button>
    </div>
  );
}

// ── Construtor de condição (drill-down) ───────────────────────────────────────
function ConditionBuilder({
  shapes,
  root,
  onAdd,
}: {
  shapes: Shapes;
  root: string;
  onAdd: (c: Condition) => void;
}) {
  const [segments, setSegments] = useState<string[]>([]);
  const [op, setOp] = useState<string>("");
  const [value, setValue] = useState<string>("");

  const { chosen, nextFields, leaf } = resolvePath(shapes, root, segments);

  const pickField = (name: string) => {
    const node = nextFields[name];
    setSegments([...segments, name]);
    if (node?.kind === "column") {
      setOp(operatorsFor(node)[0]?.value ?? "");
      setValue("");
    }
  };
  const truncate = (i: number) => {
    setSegments(segments.slice(0, i));
    setOp("");
    setValue("");
  };

  const needsValue = op !== "" && !NO_VALUE.has(op);
  const canAdd = !!leaf && op !== "" && (!needsValue || value.trim() !== "");
  const add = () => {
    if (!canAdd) return;
    onAdd({ path: segments, op, ...(needsValue ? { value } : {}) });
    setSegments([]);
    setOp("");
    setValue("");
  };

  return (
    <div class={css.row}>
      {chosen.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span class={css.sep}>›&nbsp;</span> : null}
          <button class={`${css.chip} ${css.chipBtn}`} onClick={() => truncate(i)} title="edit from here">
            {fieldLabel(c.name)}
            <span class={`${css.chipBadge} ${badgeClass(kindOf(c.node))}`}>{kindLabel(c.node)}</span>
          </button>
        </span>
      ))}

      {!leaf ? (
        <Select
          options={fieldOptions(nextFields)}
          value=""
          onChange={pickField}
          placeholder={chosen.length === 0 ? "where…" : "field…"}
          mono
        />
      ) : (
        <>
          <Select options={operatorsFor(leaf)} value={op} onChange={setOp} searchable={false} />
          {needsValue ? (
            <input
              class={css.valueInput}
              type={inputType(leaf)}
              placeholder="value"
              value={value}
              onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
          ) : null}
          <button class={btn.primary} disabled={!canAdd} onClick={add}>
            Add
          </button>
        </>
      )}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
function decode(active: Filter | null): { match: "all" | "any"; conditions: Condition[] } {
  if (!active) return { match: "all", conditions: [] };
  if ("and" in active) return { match: "all", conditions: active.and.filter(isCondition) };
  if ("or" in active) return { match: "any", conditions: active.or.filter(isCondition) };
  return { match: "all", conditions: [active] };
}
function isCondition(n: Filter): n is Condition {
  return "path" in n;
}

function resolvePath(shapes: Shapes, root: string, segments: string[]) {
  const chosen: { name: string; node: FieldIR }[] = [];
  let fields = shapes[root] ?? {};
  for (const name of segments) {
    let node = fields[name];
    if (!node && MANAGED[name]) node = { kind: "column", type: MANAGED[name]!.type } as ColumnIR;
    if (!node) break;
    chosen.push({ name, node });
    if (node.kind === "column") {
      fields = {};
      break;
    }
    fields = node.kind === "owned" ? (node.shape ?? {}) : (shapes[node.target] ?? {});
  }
  const last = chosen[chosen.length - 1];
  const leaf = last && last.node.kind === "column" ? (last.node as ColumnIR) : null;
  return { chosen, nextFields: leaf ? {} : fields, leaf };
}

function fieldOptions(fields: Record<string, FieldIR>): SelectOption[] {
  const opts: SelectOption[] = Object.entries(fields).map(([name, node]) => ({
    value: name,
    label: name,
    hint: kindLabel(node),
  }));
  for (const [key, m] of Object.entries(MANAGED)) opts.push({ value: key, label: m.label, hint: m.type });
  return opts;
}

function kindOf(node: FieldIR): "link" | "owned" | "leaf" {
  return node.kind === "reference" ? "link" : node.kind === "owned" ? "owned" : "leaf";
}
function badgeClass(kind: "link" | "owned" | "leaf"): string {
  return kind === "link" ? css.linkBadge : kind === "owned" ? css.ownedBadge : css.leafBadge;
}
function kindLabel(node: FieldIR): string {
  if (node.kind === "reference") return node.cardinality === "many" ? "links" : "link";
  if (node.kind === "owned") return node.array ? "collection" : "object";
  return node.array ? `${node.type}[]` : node.type;
}

function operatorsFor(node: ColumnIR): SelectOption[] {
  const t = node.type;
  let ops: [string, string][];
  if (TEXT.has(t)) {
    ops = [["contains", "contains"], ["equals", "equals"], ["startsWith", "starts with"], ["isEmpty", "is empty"]];
  } else if (NUMERIC.has(t)) {
    ops = [["equals", "="], ["notEquals", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["isEmpty", "is empty"]];
  } else if (t === "bool") {
    ops = [["isTrue", "is true"], ["isFalse", "is false"]];
  } else if (DATE.has(t)) {
    ops = [["on", "on"], ["before", "before"], ["after", "after"], ["isEmpty", "is empty"]];
  } else {
    ops = [["equals", "equals"], ["isEmpty", "is empty"]];
  }
  if (node.array) {
    ops = ops.filter(([k]) => k !== "isEmpty").map(([k, l]) => [k, `any ${l}`]);
  }
  return ops.map(([value, label]) => ({ value, label }));
}

function inputType(node: ColumnIR): string {
  if (NUMERIC.has(node.type)) return "number";
  if (node.type === "date") return "date";
  if (node.type === "timestamptz" || node.type === "timestamp") return "datetime-local";
  return "text";
}
