import { useLoader } from "@mauroandre/velojs/hooks";
import type { LoaderArgs, ActionArgs } from "@mauroandre/velojs";
import { useSignal } from "@preact/signals";
import * as css from "./Todos.css.js";

interface ListView {
  id: string;
  name: string;
  color: string | null;
}
interface TodoView {
  id: string;
  title: string;
  done: boolean;
  listId: string | null;
  list: ListView | null;
}
interface LoaderData {
  ready: boolean;
  error?: string;
  lists: ListView[];
  todos: TodoView[];
}

// ── Loader: lê tudo do Weave (todos com a lista expandida) ──────────────────────
export const loader = async ({}: LoaderArgs): Promise<LoaderData> => {
  const { weave } = await import("./weave.js");
  try {
    const [lists, todos] = await Promise.all([
      weave.list.find({ orderBy: { createdAt: "asc" } }),
      weave.todo.find({ expand: { list: true }, orderBy: { createdAt: "asc" } }),
    ]);
    return { ready: true, lists: lists as ListView[], todos: todos as TodoView[] };
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : String(e), lists: [], todos: [] };
  }
};

// ── Actions: mutações via SDK (server-side) ─────────────────────────────────────
export const action_addTodo = async ({ body }: ActionArgs<{ title: string; listId: string | null }>) => {
  const { weave } = await import("./weave.js");
  try {
    await weave.todo.create({ title: body.title, listId: body.listId ?? null });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

export const action_toggleTodo = async ({ body }: ActionArgs<{ id: string; done: boolean }>) => {
  const { weave } = await import("./weave.js");
  try {
    await weave.todo.update(body.id, { done: body.done });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

export const action_deleteTodo = async ({ body }: ActionArgs<{ id: string }>) => {
  const { weave } = await import("./weave.js");
  try {
    await weave.todo.delete(body.id);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

export const action_addList = async ({ body }: ActionArgs<{ name: string; color: string }>) => {
  const { weave } = await import("./weave.js");
  try {
    await weave.list.create({ name: body.name, color: body.color });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

const PALETTE = ["#12B886", "#2F6FEB", "#e5484d", "#f59e0b", "#a855f7"];

// ── Component ───────────────────────────────────────────────────────────────────
export const Component = () => {
  const { data, refetch } = useLoader<LoaderData>([]);
  const title = useSignal("");
  const listName = useSignal("");
  const selected = useSignal<string | null>(null);
  const busy = useSignal(false);

  const d = data.value;
  if (!d) return null;

  if (!d.ready) {
    return (
      <div class={css.page}>
        <div class={css.setup}>
          <h1 class={css.setupTitle}>Almost there</h1>
          <p class={css.setupText}>Couldn't reach Weave yet. Finish the setup:</p>
          <ol class={css.setupSteps}>
            <li>
              <code>docker compose up -d</code> — start Postgres + Weave
            </li>
            <li>
              Open <a href="http://localhost:3100">localhost:3100</a>, log in (master / master), create
              an API key
            </li>
            <li>
              Put it in <code>.env</code> as <code>WEAVE_KEY</code>
            </li>
            <li>
              <code>npm run push</code> — create the entities, then reload
            </li>
          </ol>
          {d.error && <p class={css.setupError}>{d.error}</p>}
        </div>
      </div>
    );
  }

  const visible = selected.value ? d.todos.filter((t) => t.listId === selected.value) : d.todos;
  const remaining = visible.filter((t) => !t.done).length;

  const addTodo = async () => {
    const t = title.value.trim();
    if (!t || busy.value) return;
    busy.value = true;
    const r = await action_addTodo({ body: { title: t, listId: selected.value } });
    busy.value = false;
    if (!r.error) {
      title.value = "";
      refetch();
    }
  };

  const toggle = async (todo: TodoView) => {
    await action_toggleTodo({ body: { id: todo.id, done: !todo.done } });
    refetch();
  };

  const remove = async (id: string) => {
    await action_deleteTodo({ body: { id } });
    refetch();
  };

  const addList = async () => {
    const n = listName.value.trim();
    if (!n || busy.value) return;
    busy.value = true;
    const color = PALETTE[d.lists.length % PALETTE.length];
    const r = await action_addList({ body: { name: n, color } });
    busy.value = false;
    if (!r.error) {
      listName.value = "";
      refetch();
    }
  };

  return (
    <div class={css.page}>
      <div class={css.shell}>
        <header class={css.header}>
          <h1 class={css.brand}>Todos</h1>
          <span class={css.badge}>powered by Weave</span>
        </header>

        {/* Lists */}
        <div class={css.lists}>
          <button
            class={`${css.listChip} ${selected.value === null ? css.listChipActive : ""}`}
            onClick={() => (selected.value = null)}
          >
            All
          </button>
          {d.lists.map((l) => (
            <button
              key={l.id}
              class={`${css.listChip} ${selected.value === l.id ? css.listChipActive : ""}`}
              onClick={() => (selected.value = l.id)}
            >
              <span class={css.dot} style={{ backgroundColor: l.color ?? "#999" }} />
              {l.name}
            </button>
          ))}
          <input
            class={css.listInput}
            placeholder="+ list"
            value={listName.value}
            onInput={(e) => (listName.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && addList()}
          />
        </div>

        {/* Add todo */}
        <div class={css.addRow}>
          <input
            class={css.addInput}
            placeholder="What needs doing?"
            value={title.value}
            onInput={(e) => (title.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
          />
          <button class={css.addBtn} onClick={addTodo} disabled={busy.value}>
            Add
          </button>
        </div>

        {/* Todos */}
        <ul class={css.todoList}>
          {visible.length === 0 && <li class={css.empty}>Nothing here yet — add your first todo.</li>}
          {visible.map((t) => (
            <li key={t.id} class={css.todo}>
              <button
                class={`${css.check} ${t.done ? css.checkOn : ""}`}
                onClick={() => toggle(t)}
                aria-label="toggle"
              >
                {t.done ? "✓" : ""}
              </button>
              <span class={`${css.todoTitle} ${t.done ? css.todoDone : ""}`}>{t.title}</span>
              {t.list && <span class={css.todoTag} style={{ backgroundColor: t.list.color ?? "#999" }}>{t.list.name}</span>}
              <button class={css.del} onClick={() => remove(t.id)} aria-label="delete">
                ×
              </button>
            </li>
          ))}
        </ul>

        <footer class={css.footer}>{remaining} remaining</footer>
      </div>
    </div>
  );
};
