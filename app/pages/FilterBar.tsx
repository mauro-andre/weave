import { useState } from "preact/hooks";
import { Select, type SelectOption } from "../components/Select.js";
import type { ColumnIR, FieldIR } from "@mauroandre/weave-core";
import * as btn from "../styles/button.css.js";
import * as css from "./FilterBar.css.js";

type Shapes = Record<string, Record<string, FieldIR>>;

/** Nó de WhereInput em JSON (frouxo — a entidade é dinâmica na GUI). */
type WNode = Record<string, unknown>;
/** Linha do drill-down (modelo interno do widget). Emitida como WhereInput. */
type Cond = { path: string[]; op: string; value?: unknown };

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
 * Barra de filtro multi-condição. A UI monta uma lista plana combinada por `all`
 * (AND) ou `any` (OR) via drill-down sobre as formas resolvidas; mas o que ela
 * **emite e decodifica é WhereInput nativo** — o mesmo objeto que o dev escreve no
 * SDK. Não há formato path-based: o caminho vira chaves aninhadas, owned/ref to-many
 * viram `some`, e o operador é o do WhereInput (com label amigável).
 */
export function FilterBar({
  shapes,
  root,
  active,
  onChange,
}: {
  shapes: Shapes;
  root: string;
  active: WNode | null;
  onChange: (w: WNode | null) => void;
}) {
  const decoded = decode(active, shapes, root);
  const [match, setMatch] = useState<"all" | "any">(decoded.match);
  const [conditions, setConditions] = useState<Cond[]>(decoded.conditions);

  const emit = (conds: Cond[], m: "all" | "any") => onChange(buildWhere(conds, m, shapes, root));
  const add = (c: Cond) => {
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
  condition: Cond;
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
  onAdd: (c: Cond) => void;
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

// ── WhereInput: build (linhas → objeto) e decode (objeto → linhas) ─────────────

/** Monta o WhereInput a partir das linhas + match. 0 → null; 1 → folha; N → and/or. */
function buildWhere(conditions: Cond[], match: "all" | "any", shapes: Shapes, root: string): WNode | null {
  if (conditions.length === 0) return null;
  const leaves = conditions.map((c) => buildLeaf(c, shapes, root));
  if (leaves.length === 1) return leaves[0]!;
  return match === "all" ? { and: leaves } : { or: leaves };
}

/** Caminho → objeto aninhado (`some` em to-many) + filtro de folha no operador. */
function buildLeaf(cond: Cond, shapes: Shapes, root: string): WNode {
  const { chosen } = resolvePath(shapes, root, cond.path);
  if (chosen.length === 0) return {};
  const last = chosen[chosen.length - 1]!;
  let acc: WNode = { [last.name]: leafFilter(last.node, cond.op, cond.value) };
  for (let i = chosen.length - 2; i >= 0; i--) {
    const { name, node } = chosen[i]!;
    const toMany =
      node.kind === "owned" ? node.array : node.kind === "reference" ? node.cardinality === "many" : false;
    acc = { [name]: toMany ? { some: acc } : acc };
  }
  return acc;
}

/**
 * Operador da UI → objeto de operador WhereInput (curinga automático em
 * contains/startsWith). Em coluna array, o operador escalar é embrulhado em
 * `{ some: … }` ("algum elemento casa") — exceto `isEmpty`.
 */
function leafFilter(node: FieldIR | undefined, op: string, value: unknown): WNode {
  const isArray = node?.kind === "column" && node.array === true;
  const t = node?.kind === "column" ? node.type : "";
  const v = NUMERIC.has(t) ? Number(value) : value;
  let sc: WNode;
  switch (op) {
    case "contains":
      sc = { ilike: `%${value}%` };
      break;
    case "startsWith":
      sc = { ilike: `${value}%` };
      break;
    case "equals":
      sc = { eq: v };
      break;
    case "notEquals":
      sc = { ne: v };
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      sc = { [op]: v };
      break;
    case "on":
      sc = { eq: v };
      break;
    case "before":
      sc = { lt: v };
      break;
    case "after":
      sc = { gt: v };
      break;
    case "isTrue":
      sc = { eq: true };
      break;
    case "isFalse":
      sc = { eq: false };
      break;
    case "isEmpty":
      return isArray ? { isEmpty: true } : { isNull: true };
    default:
      sc = { eq: v };
  }
  return isArray ? { some: sc } : sc;
}

/** Decodifica um WhereInput (saída desta barra) de volta em linhas + match. */
function decode(active: WNode | null, shapes: Shapes, root: string): { match: "all" | "any"; conditions: Cond[] } {
  if (!active) return { match: "all", conditions: [] };
  if (Array.isArray(active["and"])) {
    return { match: "all", conditions: (active["and"] as WNode[]).map((n) => decodeBranch(n, shapes, root)) };
  }
  if (Array.isArray(active["or"])) {
    return { match: "any", conditions: (active["or"] as WNode[]).map((n) => decodeBranch(n, shapes, root)) };
  }
  return { match: "all", conditions: [decodeBranch(active, shapes, root)] };
}

const isObj = (v: unknown): v is WNode => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Desce o galho single-branch até a folha (uma COLUNA, detectada via `resolvePath`).
 * Relações (owned/ref) são desembrulhadas — `some` em to-many — até chegar na coluna;
 * em coluna array, o operador escalar está sob `some`.
 */
function decodeBranch(node: WNode, shapes: Shapes, root: string): Cond {
  const path: string[] = [];
  let cur: WNode = node;
  for (let guard = 0; guard < 16; guard++) {
    const entry = Object.entries(cur)[0];
    if (!entry) break;
    const [key, val] = entry;
    path.push(key);
    const { leaf } = resolvePath(shapes, root, path);
    if (leaf) {
      const opObj = leaf.array && isObj(val) && "some" in val ? ((val as { some: WNode }).some ?? {}) : (val as WNode);
      return { path, ...decodeLeaf(opObj, leaf) };
    }
    cur = isObj(val) && "some" in val ? ((val as { some: WNode }).some ?? {}) : (val as WNode);
  }
  return { path, op: "equals" };
}

/** Objeto de operador WhereInput → operador da UI + valor (inverso do leafFilter). */
function decodeLeaf(val: WNode, leaf: ColumnIR): { op: string; value?: unknown } {
  const isDate = DATE.has(leaf.type);
  const unwrap = (s: unknown): { op: string; value: unknown } => {
    const str = String(s);
    if (str.startsWith("%") && str.endsWith("%")) return { op: "contains", value: str.slice(1, -1) };
    if (str.endsWith("%")) return { op: "startsWith", value: str.slice(0, -1) };
    return { op: "contains", value: str };
  };
  if ("ilike" in val) return unwrap(val["ilike"]);
  if ("hasIlike" in val) return unwrap(val["hasIlike"]);
  if ("has" in val) return { op: "equals", value: val["has"] };
  if ("eq" in val) {
    if (val["eq"] === true) return { op: "isTrue" };
    if (val["eq"] === false) return { op: "isFalse" };
    return { op: isDate ? "on" : "equals", value: val["eq"] };
  }
  if ("ne" in val) return { op: "notEquals", value: val["ne"] };
  if ("gt" in val) return { op: isDate ? "after" : "gt", value: val["gt"] };
  if ("gte" in val) return { op: "gte", value: val["gte"] };
  if ("lt" in val) return { op: isDate ? "before" : "lt", value: val["lt"] };
  if ("lte" in val) return { op: "lte", value: val["lte"] };
  if ("isNull" in val || "isEmpty" in val) return { op: "isEmpty" };
  return { op: "equals" };
}

// ── helpers de drill-down (inalterados) ───────────────────────────────────────
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
