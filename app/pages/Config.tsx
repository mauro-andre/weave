import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import type { Context } from "hono";
import { useLoader } from "@mauroandre/velojs/hooks";
import { useSignal } from "@preact/signals";
import { Page } from "../components/Page.js";
import * as btn from "../styles/button.css.js";
import * as css from "./Config.css.js";

// ── dados ─────────────────────────────────────────────────────────────────────

export interface SettingsLoaded {
  twofaEnabled: boolean;
}

export const loader = async ({ c }: LoaderArgs): Promise<SettingsLoaded> => {
  const session = sessionUser(c);
  if (!session) return { twofaEnabled: false };
  const { findUserById } = await import("../engine/control-plane/users.js");
  const user = await findUserById(session.id);
  return { twofaEnabled: user?.twofa_enabled ?? false };
};

function sessionUser(c: Context | undefined): { id: string } | null {
  const user = c?.get("user") as { id?: unknown } | undefined;
  return user && typeof user.id === "string" ? { id: user.id } : null;
}

// ── actions do 2FA (todas exigem a sessão do operador) ────────────────────────

/** Fase 1 do enable: gera o secret pendente e devolve QR (SVG) + secret + URI. NÃO ativa nada. */
export const action_2fa_begin = async ({ c }: ActionArgs) => {
  const session = sessionUser(c);
  if (!session) return { error: "unauthorized" };
  const { findUserById } = await import("../engine/control-plane/users.js");
  const user = await findUserById(session.id);
  if (!user) return { error: "unauthorized" };
  const { beginTwoFa } = await import("../engine/control-plane/twofa.js");
  try {
    return await beginTwoFa(user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to start 2FA setup." };
  }
};

/** Fase 2: um código válido ATIVA o fator e devolve os 10 recovery codes (uma única vez). */
export const action_2fa_confirm = async ({ c, body }: ActionArgs<{ code: string }>) => {
  const session = sessionUser(c);
  if (!session) return { error: "unauthorized" };
  const { confirmTwoFa } = await import("../engine/control-plane/twofa.js");
  return await confirmTwoFa(session.id, (body.code ?? "").trim());
};

/** Desligar EXIGE código válido (TOTP ou recovery não consumido) — a sessão sozinha não basta. */
export const action_2fa_disable = async ({ c, body }: ActionArgs<{ code: string }>) => {
  const session = sessionUser(c);
  if (!session) return { error: "unauthorized" };
  const { disableTwoFa } = await import("../engine/control-plane/twofa.js");
  return await disableTwoFa(session.id, (body.code ?? "").trim());
};

// ── card ──────────────────────────────────────────────────────────────────────

type Phase = "idle" | "pending" | "recovery" | "disabling";

export const Component = () => {
  const { data, refetch } = useLoader<SettingsLoaded>();

  const phase = useSignal<Phase>("idle");
  const error = useSignal("");
  const busy = useSignal(false);
  const pending = useSignal<{ secret: string; otpauth: string; qrSvg: string } | null>(null);
  const recoveryCodes = useSignal<string[]>([]);
  const code = useSignal("");

  const enabled = () => data.value?.twofaEnabled ?? false;

  const begin = async () => {
    busy.value = true;
    error.value = "";
    const res = (await action_2fa_begin({ body: {} })) as typeof pending.value & { error?: string };
    busy.value = false;
    if (res?.error || !res?.secret) {
      error.value = res?.error ?? "Failed to start 2FA setup.";
      return;
    }
    pending.value = res;
    code.value = "";
    phase.value = "pending";
  };

  const confirm = async () => {
    busy.value = true;
    error.value = "";
    const res = (await action_2fa_confirm({ body: { code: code.value } })) as {
      ok?: boolean;
      recoveryCodes?: string[];
      error?: string;
    };
    busy.value = false;
    if (!res.ok || !res.recoveryCodes) {
      error.value = res.error ?? "Invalid verification code.";
      return;
    }
    recoveryCodes.value = res.recoveryCodes;
    code.value = "";
    phase.value = "recovery";
  };

  const disable = async () => {
    busy.value = true;
    error.value = "";
    const res = (await action_2fa_disable({ body: { code: code.value } })) as { ok?: boolean; error?: string };
    busy.value = false;
    if (!res.ok) {
      error.value = res.error ?? "Invalid verification code.";
      return;
    }
    code.value = "";
    phase.value = "idle";
    refetch();
  };

  const done = () => {
    recoveryCodes.value = [];
    pending.value = null;
    phase.value = "idle";
    refetch();
  };

  return (
    <Page title="Settings">
      <section class={css.card}>
        <div class={css.head}>
          <h2 class={css.title}>Two-factor authentication</h2>
          {enabled() && phase.value !== "recovery" ? (
            <span class={css.badgeOn}>On</span>
          ) : (
            <span class={css.badgeOff}>Off</span>
          )}
        </div>

        {!enabled() && phase.value === "idle" ? (
          <>
            <p class={css.hint}>
              Add a second factor to your sign-in: a 6-digit code from any TOTP authenticator (Bitwarden,
              1Password, Authy, Google Authenticator…), plus 10 one-time recovery codes.
            </p>
            <div class={css.actions}>
              <button class={btn.primary} disabled={busy.value} onClick={begin}>
                Enable
              </button>
            </div>
          </>
        ) : null}

        {phase.value === "pending" && pending.value ? (
          <div class={css.pending}>
            <div class={css.qrBox}>
              <div
                class={css.qrSvg}
                dangerouslySetInnerHTML={{ __html: pending.value.qrSvg }}
              />
            </div>
            <div class={css.pendingInfo}>
              <p class={css.hint}>
                Scan the QR with your authenticator — or type the secret below by hand. Then enter the 6-digit
                code it generates to turn the factor on.
              </p>
              <code class={css.mono}>{pending.value.secret}</code>
              <div class={css.pendingRow}>
                <input
                  class={css.input}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code.value}
                  onInput={(e) => (code.value = (e.currentTarget as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirm();
                  }}
                />
                <button class={btn.primary} disabled={busy.value} onClick={confirm}>
                  Verify &amp; enable
                </button>
                <button class={btn.ghost} onClick={done}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {phase.value === "recovery" ? (
          <div class={css.recovery}>
            <p class={css.recoveryTitle}>
              Save your recovery codes now — they are shown only once.
            </p>
            <p class={css.hint}>
              Each code works once in the code field at sign-in, for when you lose the authenticator. Keep them
              somewhere safe (password manager, printed).
            </p>
            <ul class={css.recoveryList}>
              {recoveryCodes.value.map((rc) => (
                <li class={css.recoveryItem}>{rc}</li>
              ))}
            </ul>
            <div class={css.actions}>
              <button
                class={btn.ghost}
                onClick={() => navigator.clipboard?.writeText(recoveryCodes.value.join("\n"))}
              >
                Copy all
              </button>
              <button class={btn.primary} onClick={done}>
                I saved them — done
              </button>
            </div>
          </div>
        ) : null}

        {enabled() && (phase.value === "idle" || phase.value === "disabling") ? (
          <>
            <p class={css.hint}>
              Your sign-in asks for a 6-digit code (or a recovery code) after the password.
            </p>
            <div class={css.actions}>
              {phase.value === "disabling" ? (
                <>
                  <input
                    class={css.input}
                    placeholder="Code to confirm disable"
                    inputMode="numeric"
                    value={code.value}
                    onInput={(e) => (code.value = (e.currentTarget as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") disable();
                    }}
                  />
                  <button class={btn.danger} disabled={busy.value} onClick={disable}>
                    Disable 2FA
                  </button>
                  <button
                    class={btn.ghost}
                    onClick={() => {
                      phase.value = "idle";
                      code.value = "";
                      error.value = "";
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button class={btn.danger} onClick={() => (phase.value = "disabling")}>
                  Disable
                </button>
              )}
            </div>
          </>
        ) : null}

        {error.value ? (
          <p class={css.error} role="alert">
            {error.value}
          </p>
        ) : null}

        <p class={css.note}>
          Lost the authenticator and the recovery codes? The only way back is clearing the 2FA columns directly
          in the database (<code>twofa_secret</code>, <code>twofa_enabled</code>, <code>twofa_last_step</code>,{" "}
          <code>twofa_recovery</code> on <code>weave_users</code>). The same applies if <code>SESSION_SECRET</code>{" "}
          is rotated: the encrypted secrets become undecipherable — clear the columns and enable the factor again.
        </p>
      </section>
    </Page>
  );
};
