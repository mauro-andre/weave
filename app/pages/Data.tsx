import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import { useLoader, useNavigate, touch } from "@mauroandre/velojs/hooks";
import { useSignal } from "@preact/signals";
import { useState, useEffect, useRef } from "preact/hooks";
import { Page } from "../components/Page.js";
import { Select } from "../components/Select.js";
import { FilterBar } from "./FilterBar.js";
import { SortBar } from "./SortBar.js";
import { ConfirmModal } from "../components/ConfirmModal.js";
import { camelize } from "@mauroandre/weave-core";
import type { ColumnIR, FieldIR } from "@mauroandre/weave-core";
import type { ObjectPage } from "../engine/control-plane/data.js";
import * as btn from "../styles/button.css.js";
import * as css from "./Data.css.js";

/** WhereInput / OrderByInput em JSON (frouxo — entidade dinâmica na GUI). */
type WNode = Record<string, unknown>;

const SHOW_LIMIT = 6; // campos visíveis antes do "show all fields"
const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);
// Tipos textuais livres: editam num textarea multilinha (o resto — uuid, datas, etc. — em input de 1 linha).
const TEXTUAL = new Set(["text", "varchar", "bpchar"]);

interface DataLoaded {
  entities: string[];
  /** Entidade da URL (`?entity=`), ou null se nenhuma/ inválida. */
  selected: string | null;
  /** Página de objetos da entidade selecionada (null se nenhuma selecionada). */
  page: ObjectPage | null;
  /** Filtro ativo (WhereInput), decodificado da URL (`?where=` em JSON). */
  where: WNode | null;
  /** Ordenação ativa (OrderByInput), decodificada da URL (`?orderBy=` em JSON). */
  orderBy: WNode | null;
}

// Estado na URL (`?entity=&page=&where=&orderBy=`) → o loader busca server-side,
// então refresh e link direto funcionam. Sem `entity`, nada é mostrado.
export const loader = async ({ query }: LoaderArgs): Promise<DataLoaded> => {
  const { listEntities } = await import("../engine/control-plane/entities.js");
  const entities = (await listEntities()).map((e) => e.name);
  const selected = query.entity && entities.includes(query.entity) ? query.entity : null;
  const where = selected ? parseJson<WNode>(query.where) : null;
  const orderBy = selected ? parseJson<WNode>(query.orderBy) : null;
  let page: ObjectPage | null = null;
  if (selected) {
    const { listObjects } = await import("../engine/control-plane/data.js");
    page = await listObjects(selected, Math.max(1, Number(query.page) || 1), 20, where ?? {}, orderBy);
  }
  return { entities, selected, page, where, orderBy };
};

function urlFor(entity: string, p: number, w: WNode | null, ob: WNode | null): string {
  let u = `/data?entity=${encodeURIComponent(entity)}&page=${p}`;
  if (w) u += `&where=${encodeURIComponent(JSON.stringify(w))}`;
  if (ob) u += `&orderBy=${encodeURIComponent(JSON.stringify(ob))}`;
  return u;
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const action_listObjects = async ({
  body,
}: ActionArgs<{ name: string; page?: number; where?: WNode | null; orderBy?: WNode | null }>) => {
  const { listObjects } = await import("../engine/control-plane/data.js");
  try {
    return await listObjects(body.name, body.page ?? 1, 20, body.where ?? {}, body.orderBy ?? null);
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

export const action_deleteObject = async ({ body }: ActionArgs<{ name: string; id: string }>) => {
  const { deleteObject } = await import("../engine/control-plane/data.js");
  try {
    await deleteObject(body.name, body.id);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete object." };
  }
};

type Shapes = Record<string, Record<string, FieldIR>>;

export const Component = () => {
  const { data } = useLoader<DataLoaded>();
  const navigate = useNavigate();
  const loaded = data.value;
  const entities = loaded?.entities ?? [];

  // Estado vivo (client). Inicializa do loader (refresh/link diretos via URL).
  const selected = useSignal<string | null>(loaded?.selected ?? null);
  const page = useSignal<ObjectPage | null>(loaded?.page ?? null);
  const where = useSignal<WNode | null>(loaded?.where ?? null);
  const orderBy = useSignal<WNode | null>(loaded?.orderBy ?? null);
  const loading = useSignal(false);
  const creating = useSignal(false);
  const inited = useRef(false);

  // Sincroniza uma vez quando o loader chega (navegação SPA pra cá, hydrate).
  useEffect(() => {
    if (!loaded || inited.current) return;
    selected.value = loaded.selected;
    page.value = loaded.page;
    where.value = loaded.where;
    orderBy.value = loaded.orderBy;
    inited.current = true;
  }, [loaded]);

  // Troca de entidade / página / filtro / sort: busca via action E reflete na URL.
  const load = async (entity: string, p: number, w: WNode | null, ob: WNode | null) => {
    selected.value = entity;
    where.value = w;
    orderBy.value = ob;
    creating.value = false;
    loading.value = true;
    navigate(urlFor(entity, p, w, ob));
    const res = (await action_listObjects({ body: { name: entity, page: p, where: w, orderBy: ob } })) as
      | ObjectPage
      | { error: string };
    loading.value = false;
    page.value = "error" in res ? null : res;
  };
  const reload = () => {
    creating.value = false;
    if (selected.value) void load(selected.value, page.value?.currentPage ?? 1, where.value, orderBy.value);
  };

  const sel = selected.value;
  const cur = page.value;

  return (
    <Page
      title="Data"
      actions={
        sel ? (
          <button class={btn.primary} onClick={() => (creating.value = true)}>
            + New {sel}
          </button>
        ) : undefined
      }
    >
      {entities.length === 0 ? (
        <p class={css.empty}>No entities yet. Create one first.</p>
      ) : (
        <div class={css.picker}>
          <Select
            options={entities.map((name) => ({ value: name, label: camelize(name) }))}
            value={sel ?? ""}
            onChange={(name) => load(name, 1, null, null)}
            placeholder="Select entity…"
            mono
          />
          {sel && cur ? (
            <span class={css.countBadge}>
              <span class={css.countNum}>{cur.docsQuantity.toLocaleString()}</span>
              {where.value ? "matching" : cur.docsQuantity === 1 ? "object" : "objects"}
            </span>
          ) : null}
        </div>
      )}

      {sel && cur ? (
        <FilterBar
          key={`f:${sel}:${JSON.stringify(where.value)}`}
          shapes={cur.shapes}
          root={cur.root}
          active={where.value}
          onChange={(f) => load(sel, 1, f, orderBy.value)}
        />
      ) : null}

      {sel && cur ? (
        <SortBar
          key={`s:${sel}:${JSON.stringify(orderBy.value)}`}
          shapes={cur.shapes}
          root={cur.root}
          active={orderBy.value}
          onChange={(s) => load(sel, 1, where.value, s)}
        />
      ) : null}

      {entities.length === 0 ? null : loading.value ? (
        <p class={css.empty}>Loading…</p>
      ) : !sel ? (
        <p class={css.empty}>Select an entity to browse its objects.</p>
      ) : cur ? (
        <>
          <div class={css.list}>
            {creating.value ? (
              <RootCard
                shapes={cur.shapes}
                root={cur.root}
                doc={{}}
                isNew
                onSaved={reload}
                onDiscard={() => (creating.value = false)}
              />
            ) : null}
            {cur.docs.length === 0 && !creating.value ? (
              <p class={css.empty}>No objects in {cur.root} yet.</p>
            ) : (
              cur.docs.map((doc, i) => (
                <RootCard key={(doc.id as string) ?? i} shapes={cur.shapes} root={cur.root} doc={doc} onSaved={reload} />
              ))
            )}
          </div>
          {cur.pageQuantity > 1 ? (
            <div class={css.pager}>
              <button
                class={css.pagerBtn}
                disabled={cur.currentPage <= 1}
                onClick={() => load(cur.root, cur.currentPage - 1, where.value, orderBy.value)}
              >
                ◀
              </button>
              <span>
                {cur.currentPage} / {cur.pageQuantity} · {cur.docsQuantity} objects
              </span>
              <button
                class={css.pagerBtn}
                disabled={cur.currentPage >= cur.pageQuantity}
                onClick={() => load(cur.root, cur.currentPage + 1, where.value, orderBy.value)}
              >
                ▶
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </Page>
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
  const confirming = useSignal(false);
  const deleting = useSignal(false);
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
  const doDelete = async () => {
    deleting.value = true;
    err.value = "";
    const res = (await action_deleteObject({ body: { name: root, id: String(doc.id) } })) as { error?: string };
    deleting.value = false;
    confirming.value = false;
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
              {!isNew ? (
                <button class={btn.danger} onClick={() => (confirming.value = true)}>
                  Delete
                </button>
              ) : null}
              <button class={btn.ghost} onClick={cancel}>
                Cancel
              </button>
              <button class={btn.primary} disabled={saving.value} onClick={save}>
                {saving.value ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button class={btn.ghost} onClick={startEdit}>
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

      {confirming.value ? (
        <ConfirmModal
          title={`Delete this ${camelize(root)}?`}
          message="This permanently deletes the object and its nested data. This can't be undone."
          confirmLabel="Delete"
          danger
          busy={deleting.value}
          onConfirm={doDelete}
          onCancel={() => (confirming.value = false)}
        />
      ) : null}
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
  // jsonb (objeto/array): bloco indentado + colorido — não o "[object Object]" do String(obj).
  if (typeof value === "object" && !(value instanceof Date)) {
    return (
      <pre class={css.jsonView} dangerouslySetInnerHTML={{ __html: highlightJson(JSON.stringify(value, null, 2)) }} />
    );
  }
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

  // jsonb/json: edita o JSON num textarea; só grava quando parseia (senão marca inválido
  // e mantém o último válido no objeto — não corrompe com a string "[object Object]").
  if (node.type === "jsonb" || node.type === "json") {
    return (
      <JsonEditInput
        value={v}
        onChange={(val) => {
          obj[name] = val;
          bump();
        }}
      />
    );
  }

  // Textual livre: textarea multilinha auto-crescente (aceita quebras de linha).
  if (TEXTUAL.has(node.type)) {
    return <TextEditInput obj={obj} name={name} bump={bump} />;
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

// Textarea de coluna textual: começa com 1 linha e cresce com o conteúdo (altura =
// scrollHeight). Ajusta na montagem (pra valores já multilinha) e a cada tecla.
function TextEditInput({ obj, name, bump }: { obj: Record<string, unknown>; name: string; bump: () => void }) {
  const v = obj[name];
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => grow(ref.current), []);
  return (
    <textarea
      ref={ref}
      class={css.editTextarea}
      rows={1}
      value={v === null || v === undefined ? "" : String(v)}
      onInput={(e) => {
        const el = e.currentTarget as HTMLTextAreaElement;
        obj[name] = el.value === "" ? null : el.value;
        grow(el);
        bump();
      }}
    />
  );
}

// Colore JSON cru (mesmo enquanto inválido, durante a digitação): escapa o HTML e
// envolve os tokens em spans. String seguida de `:` = chave. Puramente cosmético.
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function highlightJson(text: string): string {
  return escHtml(text).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g,
    (m, str, colon, num, kw, punct) => {
      if (str !== undefined)
        return colon
          ? `<span class="${css.jKey}">${str}</span><span class="${css.jPunct}">${colon}</span>`
          : `<span class="${css.jStr}">${str}</span>`;
      if (num !== undefined) return `<span class="${css.jNum}">${num}</span>`;
      if (kw !== undefined) return `<span class="${css.jKw}">${kw}</span>`;
      if (punct !== undefined) return `<span class="${css.jPunct}">${punct}</span>`;
      return m;
    },
  );
}

// Editor de um valor jsonb: highlight layered (textarea transparente sobre um <pre>
// colorido, alinhados). Parseia a cada tecla; grava só quando é JSON válido, senão marca
// a borda vermelha e mantém o último valor bom (não corrompe). Vazio = null.
function JsonEditInput({ value, onChange }: { value: unknown; onChange: (val: unknown) => void }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  // O `<pre>` precisa de um char no fim se o texto termina em \n, senão a última linha some.
  const html = highlightJson(text) + (text.endsWith("\n") ? "​" : "");
  return (
    <div class={`${css.jsonEditor}${invalid ? ` ${css.jsonInvalid}` : ""}`}>
      <pre class={css.jsonPre} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        class={css.jsonArea}
        spellcheck={false}
        value={text}
        onInput={(e) => {
          const raw = (e.currentTarget as HTMLTextAreaElement).value;
          setText(raw);
          if (raw.trim() === "") {
            setInvalid(false);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(raw));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
    </div>
  );
}
