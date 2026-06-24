import type { LoaderArgs } from "@mauroandre/velojs";
import { useLoader, useParams, useNavigate, touch } from "@mauroandre/velojs/hooks";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { catalog } from "../engine/types/registry.js";
import { ownedChildTable } from "../engine/util/naming.js";
import { singularize } from "../engine/util/inflect.js";
import { slug } from "../engine/util/slug.js";
import type { ColumnIR, EntityIR, FieldIR } from "../engine/ir/types.js";
import { action_saveEntity } from "./Entities.js";
import * as css from "./EntityDesigner.css.js";

// As 6 possibilidades (§ designer): primitivo/objeto × único/lista × owned/reference.
type Family = "scalar" | "scalarList" | "ownedOne" | "ownedMany" | "refOne" | "refMany";

interface Field {
  id: string;
  name: string;
  family: Family;
  type: string;
  notNull: boolean;
  unique: boolean;
  index: boolean;
  fields: Field[];
  target: string;
}

interface EntityModel {
  name: string;
  fields: Field[];
}

interface LoaderData {
  entities: string[];
  current: EntityIR | null;
}

const TYPES = Object.keys(catalog);

let _id = 0;
const newField = (): Field => ({
  id: String(++_id),
  name: "",
  family: "scalar",
  type: "text",
  notNull: false,
  unique: false,
  index: false,
  fields: [],
  target: "",
});

// ── Loader: entidades existentes (alvo de reference) + a atual (se editando) ──
export const loader = async ({ params }: LoaderArgs): Promise<LoaderData> => {
  const { listEntities, getEntity } = await import("../engine/control-plane/entities.js");
  const all = await listEntities();
  const name = params.name;
  const current = name && name !== "new" ? await getEntity(name) : null;
  return { entities: all.map((e) => e.name), current };
};

// ── IR ↔ modelo ───────────────────────────────────────────────────────────────
function toIR(m: EntityModel): EntityIR {
  return { irVersion: 1, name: m.name, fields: shapeOf(m.fields) };
}

function shapeOf(fields: Field[]): Record<string, FieldIR> {
  const out: Record<string, FieldIR> = {};
  for (const f of fields) if (f.name) out[f.name] = fieldToIR(f);
  return out;
}

function fieldToIR(f: Field): FieldIR {
  switch (f.family) {
    case "scalar":
      return col(f, false);
    case "scalarList":
      return col(f, true);
    case "ownedOne":
      return { kind: "owned", array: false, shape: shapeOf(f.fields) };
    case "ownedMany":
      return { kind: "owned", array: true, shape: shapeOf(f.fields) };
    case "refOne":
      return { kind: "reference", target: f.target, cardinality: "one" };
    case "refMany":
      return { kind: "reference", target: f.target, cardinality: "many" };
  }
}

function col(f: Field, array: boolean): ColumnIR {
  const c: ColumnIR = { kind: "column", type: f.type };
  if (array) c.array = true;
  if (f.notNull) c.notNull = true;
  if (f.unique) c.unique = true;
  if (f.index) c.index = true;
  return c;
}

function irToModel(ir: EntityIR): EntityModel {
  return { name: ir.name, fields: fieldsFromIR(ir.fields) };
}

function fieldsFromIR(fields: Record<string, FieldIR>): Field[] {
  return Object.entries(fields).map(([name, node]) => {
    const f = newField();
    f.name = name;
    if (node.kind === "column") {
      f.family = node.array ? "scalarList" : "scalar";
      f.type = node.type;
      f.notNull = !!node.notNull;
      f.unique = !!node.unique;
      f.index = !!node.index;
    } else if (node.kind === "reference") {
      f.family = node.cardinality === "many" ? "refMany" : "refOne";
      f.target = node.target;
    } else {
      f.family = node.array ? "ownedMany" : "ownedOne";
      f.fields = fieldsFromIR(node.shape);
    }
    return f;
  });
}

// ── Preview ao vivo das tabelas (espelha o collectTables do engine) ───────────
function previewTables(name: string, fields: Field[]): string[] {
  const root = slug(name);
  const out = [root];
  walkOwned(fields, singularize(root), out);
  return out;
}

function walkOwned(fields: Field[], prefix: string, out: string[]): void {
  for (const f of fields) {
    if ((f.family === "ownedOne" || f.family === "ownedMany") && f.name) {
      const child = ownedChildTable(prefix, slug(f.name), undefined);
      out.push(child);
      walkOwned(f.fields, child, out);
    }
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────
function FlagChip({
  label,
  tip,
  on,
  set,
}: {
  label: string;
  tip: string;
  on: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <span class={css.chipWrap}>
      <button type="button" class={on ? `${css.chip} ${css.chipOn}` : css.chip} onClick={() => set(!on)}>
        {label}
      </button>
      <span class={css.tooltip}>{tip}</span>
    </span>
  );
}

function FieldRow({
  field,
  entities,
  onChange,
  onRemove,
}: {
  field: Field;
  entities: string[];
  onChange: () => void;
  onRemove: () => void;
}) {
  const isOwned = field.family === "ownedOne" || field.family === "ownedMany";
  const isRef = field.family === "refOne" || field.family === "refMany";
  const isScalar = field.family === "scalar" || field.family === "scalarList";
  const accent = isOwned ? css.accentOwned : isRef ? css.accentRef : css.accentScalar;

  return (
    <div class={`${css.field} ${accent}`}>
      <div class={css.fieldRow}>
        <input
          class={css.nameInput}
          placeholder="field name"
          value={field.name}
          onInput={(e) => {
            field.name = (e.currentTarget as HTMLInputElement).value;
            onChange();
          }}
        />
        <select
          class={css.select}
          value={field.family}
          onChange={(e) => {
            field.family = (e.currentTarget as HTMLSelectElement).value as Family;
            onChange();
          }}
        >
          <optgroup label="Primitive">
            <option value="scalar">scalar</option>
            <option value="scalarList">list []</option>
          </optgroup>
          <optgroup label="Owned object">
            <option value="ownedOne">single · 1:1</option>
            <option value="ownedMany">list · 1:N</option>
          </optgroup>
          <optgroup label="Reference">
            <option value="refOne">single · N:1</option>
            <option value="refMany">many · N:N</option>
          </optgroup>
        </select>

        {isScalar ? (
          <>
            <select
              class={css.select}
              value={field.type}
              onChange={(e) => {
                field.type = (e.currentTarget as HTMLSelectElement).value;
                onChange();
              }}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div class={css.flags}>
              <FlagChip label="NN" tip="Not null" on={field.notNull} set={(v) => { field.notNull = v; onChange(); }} />
              <FlagChip label="UQ" tip="Unique" on={field.unique} set={(v) => { field.unique = v; onChange(); }} />
              <FlagChip label="IDX" tip="Indexed" on={field.index} set={(v) => { field.index = v; onChange(); }} />
            </div>
          </>
        ) : null}

        {isRef ? (
          <select
            class={css.select}
            value={field.target}
            onChange={(e) => {
              field.target = (e.currentTarget as HTMLSelectElement).value;
              onChange();
            }}
          >
            <option value="">— choose entity —</option>
            {entities.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}

        <button type="button" class={css.remove} onClick={onRemove} title="remove field">
          ✕
        </button>
      </div>

      {isOwned ? (
        <div class={css.nested}>
          <FieldList fields={field.fields} entities={entities} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}

function FieldList({
  fields,
  entities,
  onChange,
}: {
  fields: Field[];
  entities: string[];
  onChange: () => void;
}) {
  return (
    <div class={css.list}>
      {fields.map((f, i) => (
        <FieldRow
          key={f.id}
          field={f}
          entities={entities}
          onChange={onChange}
          onRemove={() => {
            fields.splice(i, 1);
            onChange();
          }}
        />
      ))}
      <button
        type="button"
        class={css.add}
        onClick={() => {
          fields.push(newField());
          onChange();
        }}
      >
        + add field
      </button>
    </div>
  );
}

export const Component = () => {
  const params = useParams<{ name: string }>();
  const isNew = !params.name || params.name === "new";
  const { data } = useLoader<LoaderData>();
  const loaded = data.value;

  const key = isNew ? "::new" : params.name;
  const entities = loaded?.entities ?? [];
  const model = useSignal<EntityModel>(
    loaded?.current ? irToModel(loaded.current) : { name: "", fields: [] },
  );

  // Re-inicializa o form quando os dados do loader chegam (navegação SPA) ou a
  // entidade muda — sem sobrescrever depois de já ter inicializado pra esta.
  const initedFor = useRef<string>(loaded ? key : "::pending");
  useEffect(() => {
    if (!loaded || initedFor.current === key) return;
    model.value = loaded.current ? irToModel(loaded.current) : { name: "", fields: [] };
    initedFor.current = key;
  }, [loaded, key]);

  const error = useSignal("");
  const saving = useSignal(false);
  const bump = () => touch(model);
  const navigate = useNavigate();

  const save = async () => {
    error.value = "";
    saving.value = true;
    const res = await action_saveEntity({ body: { ir: toIR(model.value) } });
    saving.value = false;
    if ((res as { error?: string }).error) {
      error.value = (res as { error: string }).error;
      return;
    }
    navigate("/entities"); // SPA, sem reload da tela
  };

  const tables = previewTables(model.value.name || "entity", model.value.fields);

  return (
    <div class={css.page}>
      <header class={css.header}>
        <h1 class={css.title}>{isNew ? "New entity" : `Entity: ${model.value.name}`}</h1>
        <button class={css.save} disabled={saving.value || !model.value.name} onClick={save}>
          {saving.value ? "Saving…" : "Save"}
        </button>
      </header>

      <div class={css.nameField}>
        <span class={css.label}>Entity name</span>
        <input
          class={css.nameInput}
          placeholder="e.g. products"
          value={model.value.name}
          readOnly={!isNew}
          onInput={(e) => {
            model.value.name = (e.currentTarget as HTMLInputElement).value;
            bump();
          }}
        />
      </div>

      <p class={css.managed}>
        Managed automatically: <code>id</code> · <code>createdAt</code> · <code>updatedAt</code>
      </p>

      <h2 class={css.section}>Fields</h2>
      <FieldList fields={model.value.fields} entities={entities} onChange={bump} />

      <div class={css.preview}>
        <span class={css.previewLabel}>Tables to be created: </span>
        {tables.map((t, i) => (
          <span key={t}>
            {i > 0 ? " · " : ""}
            <code class={css.table}>{t}</code>
          </span>
        ))}
      </div>

      {error.value ? (
        <p class={css.error} role="alert">
          {error.value}
        </p>
      ) : null}
    </div>
  );
};
