import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import { useLoader } from "@mauroandre/velojs/hooks";
import { useSignal } from "@preact/signals";
import { Page } from "../components/Page.js";
import { ConfirmModal } from "../components/ConfirmModal.js";
import type { ApiKeyRow } from "../engine/control-plane/api-keys.js";
import * as btn from "../styles/button.css.js";
import * as css from "./Api.css.js";

export const loader = async (_args: LoaderArgs): Promise<ApiKeyRow[]> => {
  const { listApiKeys } = await import("../engine/control-plane/api-keys.js");
  return await listApiKeys();
};

export const action_createKey = async ({ body }: ActionArgs<{ name: string }>) => {
  const { createApiKey } = await import("../engine/control-plane/api-keys.js");
  try {
    return { ok: true, ...(await createApiKey(body.name?.trim() || "Untitled")) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create key." };
  }
};

export const action_deleteKey = async ({ body }: ActionArgs<{ id: string }>) => {
  const { deleteApiKey } = await import("../engine/control-plane/api-keys.js");
  try {
    await deleteApiKey(body.id);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to revoke key." };
  }
};

export const Component = () => {
  const { data, refetch } = useLoader<ApiKeyRow[]>();
  const keys = data.value ?? [];

  const newName = useSignal("");
  const creating = useSignal(false);
  const created = useSignal<{ key: string } | null>(null); // mostra-uma-vez
  const confirmId = useSignal<string | null>(null);
  const busy = useSignal(false);

  const create = async () => {
    busy.value = true;
    const res = (await action_createKey({ body: { name: newName.value } })) as { error?: string; key?: string };
    busy.value = false;
    if (res.error || !res.key) return;
    created.value = { key: res.key };
    newName.value = "";
    creating.value = false;
    refetch();
  };
  const revoke = async (id: string) => {
    busy.value = true;
    await action_deleteKey({ body: { id } });
    busy.value = false;
    confirmId.value = null;
    refetch();
  };

  return (
    <Page
      title="API"
      actions={
        <button class={btn.primary} onClick={() => (creating.value = true)}>
          + New key
        </button>
      }
    >
      <p class={css.intro}>
        Keys for the REST API — send as the <code>x-api-key</code> header. Treat them like passwords; the full
        value is shown only once, at creation.
      </p>

      {creating.value ? (
        <div class={css.form}>
          <input
            class={css.input}
            placeholder="Key name (e.g. mobile app)"
            value={newName.value}
            onInput={(e) => (newName.value = (e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button class={btn.primary} disabled={busy.value} onClick={create}>
            Create
          </button>
          <button class={btn.ghost} onClick={() => (creating.value = false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {created.value ? (
        <div class={css.callout}>
          <strong>Copy your new key now — you won't see it again.</strong>
          <div class={css.keyRow}>
            <code class={css.keyText}>{created.value.key}</code>
            <button class={btn.ghost} onClick={() => navigator.clipboard?.writeText(created.value!.key)}>
              Copy
            </button>
          </div>
          <button class={css.dismiss} onClick={() => (created.value = null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p class={css.empty}>No keys yet. Create one to call the API.</p>
      ) : (
        <div class={css.list}>
          {keys.map((k) => (
            <div class={css.keyCard} key={k.id}>
              <div class={css.keyInfo}>
                <span class={css.name}>{k.name}</span>
                <code class={css.prefix}>{k.prefix}…</code>
                <span class={css.meta}>
                  created {fmtDate(k.created_at)}
                  {k.last_used_at ? ` · last used ${fmtDate(k.last_used_at)}` : " · never used"}
                </span>
              </div>
              <button class={btn.danger} onClick={() => (confirmId.value = k.id)}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmId.value ? (
        <ConfirmModal
          title="Revoke this key?"
          message="Apps using it will stop working immediately. This can't be undone."
          confirmLabel="Revoke"
          danger
          busy={busy.value}
          onConfirm={() => revoke(confirmId.value!)}
          onCancel={() => (confirmId.value = null)}
        />
      ) : null}
    </Page>
  );
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
