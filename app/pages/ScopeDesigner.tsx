import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import { useLoader, useParams, useNavigate, touch } from "@mauroandre/velojs/hooks";
import { useSignal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { Page } from "../components/Page.js";
import { Select, type SelectOption } from "../components/Select.js";
import { ConfirmModal } from "../components/ConfirmModal.js";
import type { ColumnIR, EntityIR, FieldIR } from "@mauroandre/weave-core";
import { camelize } from "@mauroandre/weave-core";
import type { Filter } from "../engine/control-plane/filter.js";
import type { Scope, EntityRule, Verb } from "../engine/control-plane/scopes.js";
import * as btn from "../styles/button.css.js";
import * as css from "./ScopeDesigner.css.js";

type Shapes = Record<string, Record<string, FieldIR>>;

const VERBS: [Verb, string][] = [
  ["read", "Read"],
  ["create", "Create"],
  ["update", "Update"],
  ["delete", "Delete"],
];
const NO_VALUE = new Set(["isEmpty", "isTrue", "isFalse"]);
const TEXT = new Set(["text", "varchar", "bpchar"]);
const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);

interface DraftCond {
  path: string[]; // id-path (aninhado), igual ao filtro do Data
  op: string;
  param: boolean;
  value: string;
}
interface DraftRule {
  verbs: Verb[];
  match: "all" | "any";
  conditions: DraftCond[];
  projMode: "all" | "include" | "exclude";
  projPaths: string[][];
}
interface DraftEntity {
  entity: string;
  rule: DraftRule;
}
interface Draft {
  name: string;
  entities: DraftEntity[];
}

interface LoaderData {
  scope: Scope | null;
  entities: EntityIR[];
}

export const loader = async ({ params }: LoaderArgs): Promise<LoaderData> => {
  const { getScope } = await import("../engine/control-plane/scopes.js");
  const { listEntities } = await import("../engine/control-plane/entities.js");
  const { resolveMirrors } = await import("@mauroandre/weave-core");
  const irs = await listEntities();
  const raw = new Map(irs.map((e) => [e.name, e] as const));
  const entities = irs.map((e) => resolveMirrors(e, raw));
  const name = params.name;
  const scope = name && name !== "new" ? await getScope(name) : null;
  return { scope, entities };
};

export const action_saveScope = async ({ body }: ActionArgs<{ scope: Scope }>) => {
  const { saveScope } = await import("../engine/control-plane/scopes.js");
  try {
    await saveScope(body.scope);
    return { ok: true, name: body.scope.name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save scope." };
  }
};

export const action_deleteScope = async ({ body }: ActionArgs<{ name: string }>) => {
  const { deleteScope } = await import("../engine/control-plane/scopes.js");
  try {
    await deleteScope(body.name);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete scope." };
  }
};

export const Component = () => {
  const params = useParams<{ name: string }>();
  const isNew = !params.name || params.name === "new";
  const { data } = useLoader<LoaderData>();
  const loaded = data.value;
  const entities = loaded?.entities ?? [];
  const shapes: Shapes = Object.fromEntries(entities.map((e) => [e.name, e.fields]));

  const key = isNew ? "::new" : params.name;
  const model = useSignal<Draft>(loaded?.scope ? decode(loaded.scope) : { name: "", entities: [] });
  const initedFor = useRef<string>(loaded ? key : "::pending");
  useEffect(() => {
    if (!loaded || initedFor.current === key) return;
    model.value = loaded.scope ? decode(loaded.scope) : { name: "", entities: [] };
    initedFor.current = key;
  }, [loaded, key]);

  const error = useSignal("");
  const saving = useSignal(false);
  const confirming = useSignal(false);
  const bump = () => touch(model);
  const navigate = useNavigate();

  const used = new Set(model.value.entities.map((e) => e.entity));
  // value = nome de storage (snake, chaveia `shapes`); label = nome lógico canônico (camelCase).
  const addable = entities.filter((e) => !used.has(e.name)).map((e) => ({ value: e.name, label: camelize(e.name) }));

  const addEntity = (name: string) => {
    model.value.entities.push({
      entity: name,
      rule: { verbs: ["read"], match: "all", conditions: [], projMode: "all", projPaths: [] },
    });
    bump();
  };

  const save = async () => {
    error.value = "";
    if (!model.value.name.trim()) {
      error.value = "Give the scope a name.";
      return;
    }
    saving.value = true;
    const res = (await action_saveScope({ body: { scope: toScope(model.value) } })) as { error?: string };
    saving.value = false;
    if (res.error) {
      error.value = res.error;
      return;
    }
    navigate("/scopes");
  };
  const remove = async () => {
    await action_deleteScope({ body: { name: model.value.name } });
    navigate("/scopes");
  };

  return (
    <Page
      title={isNew ? "New scope" : `Scope: ${model.value.name}`}
      actions={
        <>
          {!isNew ? (
            <button class={btn.danger} onClick={() => (confirming.value = true)}>
              Delete
            </button>
          ) : null}
          <button class={btn.primary} disabled={saving.value} onClick={save}>
            {saving.value ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div class={css.nameField}>
        <span class={css.label}>Scope name</span>
        <input
          class={css.nameInput}
          placeholder="e.g. admin"
          value={model.value.name}
          readOnly={!isNew}
          onInput={(e) => {
            model.value.name = (e.currentTarget as HTMLInputElement).value;
            bump();
          }}
        />
      </div>

      <div class={css.addRow}>
        {addable.length > 0 ? (
          <Select options={addable} value="" onChange={addEntity} placeholder="+ Add entity…" mono />
        ) : (
          <span class={css.muted}>All entities added.</span>
        )}
      </div>

      <div class={css.cards}>
        {model.value.entities.map((de, i) => (
          <RuleCard
            key={de.entity}
            entity={de.entity}
            rule={de.rule}
            shapes={shapes}
            bump={bump}
            onRemove={() => {
              model.value.entities.splice(i, 1);
              bump();
            }}
          />
        ))}
      </div>

      {error.value ? (
        <p class={css.error} role="alert">
          {error.value}
        </p>
      ) : null}

      {confirming.value ? (
        <ConfirmModal
          title={`Delete scope "${model.value.name}"?`}
          message="Requests using it will stop being authorized. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onCancel={() => (confirming.value = false)}
        />
      ) : null}
    </Page>
  );
};

// ── card de uma entidade ────────────────────────────────────────────────────
function RuleCard({
  entity,
  rule,
  shapes,
  bump,
  onRemove,
}: {
  entity: string;
  rule: DraftRule;
  shapes: Shapes;
  bump: () => void;
  onRemove: () => void;
}) {
  const fields = shapes[entity] ?? {};

  const toggleVerb = (v: Verb) => {
    rule.verbs = rule.verbs.includes(v) ? rule.verbs.filter((x) => x !== v) : [...rule.verbs, v];
    bump();
  };
  const toggleProj = (path: string[]) => {
    const exists = rule.projPaths.some((p) => eq(p, path));
    rule.projPaths = exists
      ? rule.projPaths.filter((p) => !eq(p, path))
      : [...rule.projPaths.filter((p) => !isPrefix(p, path) && !isPrefix(path, p)), path];
    bump();
  };

  return (
    <div class={css.card}>
      <div class={css.cardHead}>
        <span class={css.entityName}>{camelize(entity)}</span>
        <button class={css.remove} onClick={onRemove} title="remove entity">
          ✕
        </button>
      </div>

      <div class={css.sect}>Methods</div>
      <div class={css.chips}>
        {VERBS.map(([v, lbl]) => (
          <button key={v} class={rule.verbs.includes(v) ? `${css.chip} ${css.chipOn}` : css.chip} onClick={() => toggleVerb(v)}>
            {lbl}
          </button>
        ))}
      </div>

      <div class={css.sect}>Objects — which this scope can reach</div>
      {rule.conditions.length >= 2 ? (
        <div class={css.matchRow}>
          Match
          <div class={css.toggle}>
            {(["all", "any"] as const).map((m) => (
              <button
                key={m}
                class={rule.match === m ? `${css.toggleBtn} ${css.toggleOn}` : css.toggleBtn}
                onClick={() => {
                  rule.match = m;
                  bump();
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {rule.conditions.map((cond, i) => (
        <ScopeCond
          key={i}
          shapes={shapes}
          entity={entity}
          cond={cond}
          bump={bump}
          onRemove={() => {
            rule.conditions.splice(i, 1);
            bump();
          }}
        />
      ))}
      {Object.keys(fields).length > 0 ? (
        <button
          class={css.addCond}
          onClick={() => {
            rule.conditions.push({ path: [], op: "", param: true, value: "" });
            bump();
          }}
        >
          + add condition
        </button>
      ) : (
        <span class={css.muted}>No fields.</span>
      )}
      {rule.conditions.length === 0 ? <span class={css.muted}> · empty = every object</span> : null}

      <div class={css.sect}>Fields returned</div>
      <div class={css.toggle}>
        {(["all", "include", "exclude"] as const).map((m) => (
          <button
            key={m}
            class={rule.projMode === m ? `${css.toggleBtn} ${css.toggleOn}` : css.toggleBtn}
            onClick={() => {
              rule.projMode = m;
              bump();
            }}
          >
            {m === "all" ? "all" : m === "include" ? "only these" : "all except"}
          </button>
        ))}
      </div>
      {rule.projMode !== "all" ? (
        <div class={css.tree}>
          <FieldTree shapes={shapes} fields={fields} prefix={[]} paths={rule.projPaths} toggle={toggleProj} />
        </div>
      ) : null}
    </div>
  );
}

// ── condição de linha: drill-down aninhado (id-path) + value/param ─────────────
function ScopeCond({
  shapes,
  entity,
  cond,
  bump,
  onRemove,
}: {
  shapes: Shapes;
  entity: string;
  cond: DraftCond;
  bump: () => void;
  onRemove: () => void;
}) {
  const { crumbs, nextFields, leaf } = resolvePath(shapes, entity, cond.path);
  const needsValue = !NO_VALUE.has(cond.op);

  const pick = (id: string) => {
    const node = Object.values(nextFields).find((n) => n.id === id);
    cond.path = [...cond.path, id];
    if (node?.kind === "column") cond.op = opOptions(node.type)[0]?.value ?? "equals";
    bump();
  };
  const truncate = (i: number) => {
    cond.path = cond.path.slice(0, i);
    cond.op = "";
    bump();
  };

  return (
    <div class={css.condRow}>
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span class={css.crumbSep}>›&nbsp;</span> : null}
          <button class={css.crumb} onClick={() => truncate(i)} title="edit from here">
            {c.name}
            <span class={css.crumbBadge}>{kindLabel(c.node)}</span>
          </button>
        </span>
      ))}

      {!leaf ? (
        <Select
          options={drillOptions(nextFields)}
          value=""
          onChange={pick}
          placeholder={crumbs.length === 0 ? "field…" : "…"}
          mono
        />
      ) : (
        <>
          <Select options={opOptions(leaf.type)} value={cond.op} onChange={(op) => { cond.op = op; bump(); }} searchable={false} />
          {needsValue ? (
            <>
              <div class={css.toggle}>
                {([["value", "value"], ["param", "‹param›"]] as const).map(([mode, lbl]) => (
                  <button
                    key={mode}
                    class={(mode === "param") === cond.param ? `${css.toggleBtn} ${css.toggleOn}` : css.toggleBtn}
                    onClick={() => {
                      cond.param = mode === "param";
                      cond.value = "";
                      bump();
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <input
                class={css.input}
                placeholder={cond.param ? "param name" : "value"}
                value={cond.value}
                onInput={(e) => {
                  cond.value = (e.currentTarget as HTMLInputElement).value;
                  bump();
                }}
              />
            </>
          ) : null}
        </>
      )}
      <button class={css.remove} onClick={onRemove} title="remove">
        ✕
      </button>
    </div>
  );
}

// ── árvore de campos (projeção, recursiva) ─────────────────────────────────────
function FieldTree({
  shapes,
  fields,
  prefix,
  paths,
  toggle,
}: {
  shapes: Shapes;
  fields: Record<string, FieldIR>;
  prefix: string[];
  paths: string[][];
  toggle: (path: string[]) => void;
}) {
  return (
    <>
      {Object.entries(fields).map(([name, node]) => (
        <FieldNode key={node.id ?? name} shapes={shapes} name={name} node={node} prefix={prefix} paths={paths} toggle={toggle} />
      ))}
    </>
  );
}

function FieldNode({
  shapes,
  name,
  node,
  prefix,
  paths,
  toggle,
}: {
  shapes: Shapes;
  name: string;
  node: FieldIR;
  prefix: string[];
  paths: string[][];
  toggle: (path: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!node.id) return null;
  const path = [...prefix, node.id];
  const checked = paths.some((p) => eq(p, path));
  const rel = node.kind === "owned" || node.kind === "reference";
  const children =
    node.kind === "owned" ? (node.shape ?? {}) : node.kind === "reference" ? (shapes[node.target] ?? {}) : null;

  return (
    <div>
      <div class={css.treeRow}>
        {rel ? (
          <button class={css.expand} onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span class={css.expandSpacer} />
        )}
        <button class={checked ? `${css.fieldCheck} ${css.fieldCheckOn}` : css.fieldCheck} onClick={() => toggle(path)}>
          {name}
        </button>
        {rel ? <span class={css.kindBadge}>{kindLabel(node)}</span> : null}
      </div>
      {rel && open && children ? (
        <div class={css.treeChildren}>
          <FieldTree shapes={shapes} fields={children} prefix={path} paths={paths} toggle={toggle} />
        </div>
      ) : null}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function resolvePath(shapes: Shapes, root: string, idPath: string[]) {
  const crumbs: { id: string; name: string; node: FieldIR }[] = [];
  let fields = shapes[root] ?? {};
  for (const id of idPath) {
    const entry = Object.entries(fields).find(([, n]) => n.id === id);
    if (!entry) break;
    const [name, node] = entry;
    crumbs.push({ id, name, node });
    if (node.kind === "column") {
      fields = {};
      break;
    }
    fields = node.kind === "owned" ? (node.shape ?? {}) : (shapes[node.target] ?? {});
  }
  const last = crumbs[crumbs.length - 1];
  const leaf = last && last.node.kind === "column" ? (last.node as ColumnIR) : null;
  return { crumbs, nextFields: leaf ? {} : fields, leaf };
}

function drillOptions(fields: Record<string, FieldIR>): SelectOption[] {
  return Object.entries(fields)
    .filter(([, n]) => !!n.id)
    .map(([name, n]) => ({ value: n.id!, label: name, hint: kindLabel(n) }));
}

function kindLabel(node: FieldIR): string {
  if (node.kind === "reference") return node.cardinality === "many" ? "links" : "link";
  if (node.kind === "owned") return node.array ? "collection" : "object";
  return node.array ? `${node.type}[]` : node.type;
}

function eq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function isPrefix(a: string[], b: string[]): boolean {
  return a.length < b.length && a.every((x, i) => x === b[i]);
}

function opOptions(type: string): SelectOption[] {
  let ops: [string, string][];
  if (TEXT.has(type)) ops = [["equals", "equals"], ["notEquals", "≠"], ["contains", "contains"], ["in", "is one of"], ["isEmpty", "is empty"]];
  else if (NUMERIC.has(type)) ops = [["equals", "="], ["notEquals", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["in", "is one of"], ["isEmpty", "is empty"]];
  else if (type === "bool") ops = [["isTrue", "is true"], ["isFalse", "is false"]];
  else ops = [["equals", "equals"], ["in", "is one of"], ["isEmpty", "is empty"]];
  return ops.map(([value, label]) => ({ value, label }));
}

function decode(scope: Scope): Draft {
  const entities = Object.entries(scope.entities).map(([entity, rule]) => ({
    entity,
    rule: { verbs: rule.verbs ?? [], ...decodeRows(rule.rows), ...decodeFields(rule.fields) },
  }));
  return { name: scope.name, entities };
}
function decodeRows(rows: Filter | null): { match: "all" | "any"; conditions: DraftCond[] } {
  if (!rows) return { match: "all", conditions: [] };
  const list = "and" in rows ? rows.and : "or" in rows ? rows.or : [rows];
  const match: "all" | "any" = "or" in rows ? "any" : "all";
  const conditions = list
    .filter((n): n is Extract<Filter, { path: string[] }> => "path" in n)
    .map((c) => {
      const v = c.value as unknown;
      const param = !!v && typeof v === "object" && "param" in (v as object);
      return {
        path: c.path,
        op: c.op,
        param,
        value: param ? (v as { param: string }).param : v === undefined ? "" : String(v),
      };
    });
  return { match, conditions };
}
function decodeFields(fields: EntityRule["fields"]): { projMode: "all" | "include" | "exclude"; projPaths: string[][] } {
  if (!fields) return { projMode: "all", projPaths: [] };
  return { projMode: fields.mode, projPaths: fields.paths };
}

function toScope(draft: Draft): Scope {
  const entities: Record<string, EntityRule> = {};
  for (const { entity, rule } of draft.entities) {
    const conds = rule.conditions
      .filter((c) => c.path.length > 0 && c.op)
      .map((c) => ({ path: c.path, op: c.op, ...(NO_VALUE.has(c.op) ? {} : { value: c.param ? { param: c.value } : c.value }) }));
    const rows: Filter | null = conds.length === 0 ? null : rule.match === "all" ? { and: conds } : { or: conds };
    const fields: EntityRule["fields"] = rule.projMode === "all" ? null : { mode: rule.projMode, paths: rule.projPaths };
    entities[entity] = { verbs: rule.verbs, rows, fields };
  }
  return { name: draft.name.trim(), entities };
}
