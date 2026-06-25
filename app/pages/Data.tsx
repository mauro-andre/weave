import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import { useLoader, touch } from "@mauroandre/velojs/hooks";
import { useSignal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import type { ColumnIR, FieldIR } from "../engine/ir/types.js";
import type { ObjectPage } from "../engine/control-plane/data.js";
import * as css from "./Data.css.js";

const SHOW_LIMIT = 6; // campos visíveis antes do "show all fields"
const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);

export const loader = async (_args: LoaderArgs): Promise<string[]> => {
  const { listEntities } = await import("../engine/control-plane/entities.js");
  return (await listEntities()).map((e) => e.name);
};

export const action_listObjects = async ({ body }: ActionArgs<{ name: string; page?: number }>) => {
  const { listObjects } = await import("../engine/control-plane/data.js");
  try {
    return await listObjects(body.name, body.page ?? 1);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to load objects." };
  }
};

export const action_saveObject = async ({
  body,
}: ActionArgs<{ name: string; object: Record<string, unknown> }>) => {
  const { saveObject } = await import("../engine/control-plane/data.js");
  try {
    return { ok: true, object: await saveObject(body.name, body.object) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save object." };
  }
};

type Shapes = Record<string, Record<string, FieldIR>>;

export const Component = () => {
  const { data: loaded } = useLoader<string[]>();
  const entities = loaded.value ?? [];

  const selected = useSignal<string>("");
  const page = useSignal<ObjectPage | null>(null);
  const loading = useSignal(false);
  const creating = useSignal(false);

  const load = async (name: string, p: number) => {
    selected.value = name;
    creating.value = false;
    loading.value = true;
    const res = (await action_listObjects({ body: { name, page: p } })) as ObjectPage | { error: string };
    loading.value = false;
    page.value = "error" in res ? null : res;
  };

  useEffect(() => {
    if (entities.length && !selected.value) load(entities[0]!, 1);
  }, [entities.length]);

  const data = page.value;
  const reload = () => data && load(data.root, data.currentPage);

  return (
    <div class={css.page}>
      <header class={css.header}>
        <h1 class={css.title}>Data</h1>
        {data ? (
          <button class={css.newBtn} onClick={() => (creating.value = true)}>
            + New {data.root}
          </button>
        ) : null}
      </header>

      {entities.length === 0 ? (
        <p class={css.empty}>No entities yet. Create one first.</p>
      ) : (
        <div class={css.picker}>
          {entities.map((name) => (
            <button
              key={name}
              class={selected.value === name ? `${css.pill} ${css.pillOn}` : css.pill}
              onClick={() => load(name, 1)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {loading.value ? (
        <p class={css.empty}>Loading…</p>
      ) : data ? (
        <>
          <div class={css.list}>
            {creating.value ? (
              <RootCard
                shapes={data.shapes}
                root={data.root}
                doc={{}}
                isNew
                onSaved={reload}
                onDiscard={() => (creating.value = false)}
              />
            ) : null}
            {data.docs.length === 0 && !creating.value ? (
              <p class={css.empty}>No objects in {data.root} yet.</p>
            ) : (
              data.docs.map((doc, i) => (
                <RootCard key={(doc.id as string) ?? i} shapes={data.shapes} root={data.root} doc={doc} onSaved={reload} />
              ))
            )}
          </div>
          {data.pageQuantity > 1 ? (
            <div class={css.pager}>
              <button class={css.pagerBtn} disabled={data.currentPage <= 1} onClick={() => load(data.root, data.currentPage - 1)}>
                ◀
              </button>
              <span>
                {data.currentPage} / {data.pageQuantity} · {data.docsQuantity} objects
              </span>
              <button
                class={css.pagerBtn}
                disabled={data.currentPage >= data.pageQuantity}
                onClick={() => load(data.root, data.currentPage + 1)}
              >
                ▶
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

// ── Card raiz: alterna leitura ↔ edição inline ─────────────────────────────────
function RootCard({
  shapes,
  root,
  doc,
  isNew,
  onSaved,
  onDiscard,
}: {
  shapes: Shapes;
  root: string;
  doc: Record<string, unknown>;
  isNew?: boolean;
  onSaved: () => void;
  onDiscard?: () => void;
}) {
  const editing = useSignal(!!isNew);
  const draft = useSignal<Record<string, unknown>>(isNew ? {} : doc);
  const saving = useSignal(false);
  const err = useSignal("");
  const bump = () => touch(draft);

  const startEdit = () => {
    draft.value = structuredClone(doc);
    err.value = "";
    editing.value = true;
  };
  const cancel = () => {
    err.value = "";
    if (isNew) onDiscard?.();
    else editing.value = false;
  };
  const save = async () => {
    saving.value = true;
    err.value = "";
    const res = (await action_saveObject({ body: { name: root, object: draft.value } })) as {
      error?: string;
    };
    saving.value = false;
    if (res.error) {
      err.value = res.error;
      return;
    }
    editing.value = false;
    onSaved();
  };

  return (
    <div class={css.card}>
      <div class={css.cardHead}>
        {!isNew && doc?.id ? <span class={css.cardId}>{String(doc.id)}</span> : <span />}
        <div class={css.actions}>
          {editing.value ? (
            <>
              <button class={css.btnGhost} onClick={cancel}>
                Cancel
              </button>
              <button class={css.btnPrimary} disabled={saving.value} onClick={save}>
                {saving.value ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button class={css.btnGhost} onClick={startEdit}>
              Edit
            </button>
          )}
        </div>
      </div>

      {editing.value ? (
        <EditFields shapes={shapes} fields={shapes[root]!} obj={draft.value} bump={bump} />
      ) : (
        <ViewFields shapes={shapes} fields={shapes[root]!} data={doc} />
      )}

      {err.value ? <p class={css.errorMsg}>{err.value}</p> : null}
    </div>
  );
}

// ── Leitura ────────────────────────────────────────────────────────────────────
function ObjectCard({
  shapes,
  fields,
  data,
  showId,
}: {
  shapes: Shapes;
  fields: Record<string, FieldIR>;
  data: Record<string, unknown>;
  showId?: boolean;
}) {
  return (
    <div class={css.subCard}>
      {showId && data?.id ? <div class={css.cardId}>{String(data.id)}</div> : null}
      <ViewFields shapes={shapes} fields={fields} data={data} />
    </div>
  );
}

function ViewFields({ shapes, fields, data }: { shapes: Shapes; fields: Record<string, FieldIR>; data: Record<string, unknown> }) {
  const entries = Object.entries(fields);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, SHOW_LIMIT);
  const hidden = entries.length - visible.length;

  return (
    <>
      {visible.map(([name, node]) => (
        <FieldRow key={name} shapes={shapes} name={name} node={node} value={data?.[name]} />
      ))}
      {hidden > 0 ? (
        <button class={css.showAll} onClick={() => setShowAll(true)}>
          show all fields ({hidden} more) ⌄
        </button>
      ) : showAll && entries.length > SHOW_LIMIT ? (
        <button class={css.showAll} onClick={() => setShowAll(false)}>
          show less ⌃
        </button>
      ) : null}
    </>
  );
}

function FieldRow({ shapes, name, node, value }: { shapes: Shapes; name: string; node: FieldIR; value: unknown }) {
  if (node.kind === "owned") {
    return (
      <NestedBlock
        shapes={shapes}
        name={name}
        shape={node.shape ?? {}}
        value={value}
        variant={node.array ? "list" : "object"}
      />
    );
  }
  if (node.kind === "reference") {
    return <NestedBlock shapes={shapes} name={name} shape={shapes[node.target] ?? {}} value={value} variant="ref" />;
  }
  return (
    <div class={css.row}>
      <span class={css.fieldLabel}>{name}</span>
      <Value value={value} array={node.array ?? false} />
    </div>
  );
}

function NestedBlock({
  shapes,
  name,
  shape,
  value,
  variant,
}: {
  shapes: Shapes;
  name: string;
  shape: Record<string, FieldIR>;
  value: unknown;
  variant: "list" | "object" | "ref";
}) {
  const items = Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : value
      ? [value as Record<string, unknown>]
      : [];
  const [open, setOpen] = useState(true);
  const isRef = variant === "ref";
  const badgeText = variant === "list" ? "collection" : variant === "object" ? "object" : "link →";

  return (
    <div class={css.nested}>
      <button class={css.nestedHead} onClick={() => setOpen(!open)}>
        <span class={css.chevron}>{open ? "▾" : "▸"}</span>
        <span class={css.nestedName}>{name}</span>
        <span class={`${css.badge} ${isRef ? css.badgeRef : css.badgeOwned}`}>{badgeText}</span>
        {Array.isArray(value) ? <span class={css.count}>· {items.length}</span> : null}
      </button>
      {open ? (
        items.length === 0 ? (
          <div class={css.children}>
            <span class={css.valueNull}>empty</span>
          </div>
        ) : (
          <div class={css.children}>
            {items.map((item, i) => (
              <ObjectCard key={(item?.id as string) ?? i} shapes={shapes} fields={shape} data={item} showId={isRef} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function Value({ value, array }: { value: unknown; array?: boolean }) {
  if (value === null || value === undefined) return <span class={css.valueNull}>null</span>;
  if (array && Array.isArray(value)) {
    return <span class={css.valueStr}>{value.map((v) => String(v)).join(", ") || "—"}</span>;
  }
  if (typeof value === "boolean") return <span class={css.valueBool}>{value ? "true" : "false"}</span>;
  if (typeof value === "number" || typeof value === "bigint") return <span class={css.valueNum}>{String(value)}</span>;
  return <span class={css.valueStr}>{String(value)}</span>;
}

// ── Edição ──────────────────────────────────────────────────────────────────
function EditFields({
  shapes,
  fields,
  obj,
  bump,
}: {
  shapes: Shapes;
  fields: Record<string, FieldIR>;
  obj: Record<string, unknown>;
  bump: () => void;
}) {
  return (
    <>
      {Object.entries(fields).map(([name, node]) => {
        if (node.kind === "owned") {
          return <EditOwned key={name} shapes={shapes} name={name} node={node} obj={obj} bump={bump} />;
        }
        if (node.kind === "reference") {
          return <EditReference key={name} shapes={shapes} name={name} node={node} obj={obj} bump={bump} />;
        }
        return (
          <div key={name} class={css.row}>
            <span class={css.fieldLabel}>{name}</span>
            <EditInput node={node} obj={obj} name={name} bump={bump} />
          </div>
        );
      })}
    </>
  );
}

function EditOwned({
  shapes,
  name,
  node,
  obj,
  bump,
}: {
  shapes: Shapes;
  name: string;
  node: Extract<FieldIR, { kind: "owned" }>;
  obj: Record<string, unknown>;
  bump: () => void;
}) {
  const shape = node.shape ?? {};
  const [open, setOpen] = useState(true);

  const items: Record<string, unknown>[] = node.array
    ? Array.isArray(obj[name])
      ? (obj[name] as Record<string, unknown>[])
      : []
    : obj[name]
      ? [obj[name] as Record<string, unknown>]
      : [];

  const addItem = () => {
    if (node.array) {
      const arr = Array.isArray(obj[name]) ? (obj[name] as unknown[]) : [];
      obj[name] = [...arr, {}];
    } else {
      obj[name] = {};
    }
    bump();
  };
  const removeItem = (i: number) => {
    if (node.array) {
      const arr = (obj[name] as unknown[]).slice();
      arr.splice(i, 1);
      obj[name] = arr;
    } else {
      obj[name] = null;
    }
    bump();
  };

  return (
    <div class={css.nested}>
      <button class={css.nestedHead} onClick={() => setOpen(!open)} type="button">
        <span class={css.chevron}>{open ? "▾" : "▸"}</span>
        <span class={css.nestedName}>{name}</span>
        <span class={`${css.badge} ${css.badgeOwned}`}>{node.array ? "collection" : "object"}</span>
        {node.array ? <span class={css.count}>· {items.length}</span> : null}
      </button>
      {open ? (
        <div class={css.children}>
          {items.map((item, i) => (
            <div key={i} class={css.subCard}>
              <button class={css.removeItem} onClick={() => removeItem(i)} title="remove">
                ✕
              </button>
              <EditFields shapes={shapes} fields={shape} obj={item} bump={bump} />
            </div>
          ))}
          {node.array || items.length === 0 ? (
            <button class={css.addItem} onClick={addItem} type="button">
              + add {node.array ? "item" : name}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Reference no modo edição: o `_id` no topo fica editável; o resto fica igual à
// leitura (campos do alvo read-only, ou "empty"). O picker de busca vem depois,
// junto do motor de busca da tela Data. N:N segue read-only por ora.
function EditReference({
  shapes,
  name,
  node,
  obj,
  bump,
}: {
  shapes: Shapes;
  name: string;
  node: Extract<FieldIR, { kind: "reference" }>;
  obj: Record<string, unknown>;
  bump: () => void;
}) {
  const targetShape = shapes[node.target] ?? {};
  const [open, setOpen] = useState(true);

  if (node.cardinality === "many") {
    return (
      <div>
        <NestedBlock shapes={shapes} name={name} shape={targetShape} value={obj[name]} variant="ref" />
        <span class={css.readonlyTag}>read-only (edit links later)</span>
      </div>
    );
  }

  const current = (obj[name] as Record<string, unknown> | null) ?? null;
  const hasData = !!current && Object.keys(current).some((k) => k !== "id");
  const setId = (v: string) => {
    obj[name] = v === "" ? null : { ...(current ?? {}), id: v };
    bump();
  };

  return (
    <div class={css.nested}>
      <button class={css.nestedHead} onClick={() => setOpen(!open)} type="button">
        <span class={css.chevron}>{open ? "▾" : "▸"}</span>
        <span class={css.nestedName}>{name}</span>
        <span class={`${css.badge} ${css.badgeRef}`}>link →</span>
      </button>
      {open ? (
        <div class={css.children}>
          <div class={css.subCard}>
            <input
              class={css.idInput}
              placeholder="reference id (_id)"
              value={current?.id ? String(current.id) : ""}
              onInput={(e) => setId((e.currentTarget as HTMLInputElement).value)}
            />
            {hasData ? (
              <ViewFields shapes={shapes} fields={targetShape} data={current!} />
            ) : (
              <span class={css.valueNull}>empty</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EditInput({
  node,
  obj,
  name,
  bump,
}: {
  node: ColumnIR;
  obj: Record<string, unknown>;
  name: string;
  bump: () => void;
}) {
  const v = obj[name];

  if (node.array) {
    const text = Array.isArray(v) ? v.map((x) => String(x)).join(", ") : "";
    return (
      <input
        class={css.editInput}
        placeholder="comma, separated"
        value={text}
        onInput={(e) => {
          const raw = (e.currentTarget as HTMLInputElement).value;
          const parts = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
          obj[name] = NUMERIC.has(node.type) ? parts.map(Number) : parts;
          bump();
        }}
      />
    );
  }

  if (node.type === "bool") {
    return (
      <select
        class={css.editInput}
        value={v === true ? "true" : v === false ? "false" : ""}
        onChange={(e) => {
          const s = (e.currentTarget as HTMLSelectElement).value;
          obj[name] = s === "" ? null : s === "true";
          bump();
        }}
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  const numeric = NUMERIC.has(node.type);
  return (
    <input
      class={css.editInput}
      type={numeric ? "number" : "text"}
      value={v === null || v === undefined ? "" : String(v)}
      onInput={(e) => {
        const s = (e.currentTarget as HTMLInputElement).value;
        obj[name] = s === "" ? null : numeric ? Number(s) : s;
        bump();
      }}
    />
  );
}
