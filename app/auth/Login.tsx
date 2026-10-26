import type { ActionArgs } from "@mauroandre/velojs";
import { useState } from "preact/hooks";
import * as css from "./Login.css.js";

// Action ÚNICA de login (sem token intermediário de meia-autenticação): a
// segunda etapa revalida senha e código JUNTOS. Usuário com 2FA ativo e senha
// correta recebe `{ requires2fa: true }` — nenhuma sessão emitida — e a UI
// mostra o campo de código mantendo as credenciais visíveis. Todo erro aqui é
// a MESMA mensagem genérica de sempre: não revela se falhou a senha ou o código.
export const action_login = async ({
  body,
  c,
}: ActionArgs<{ username: string; password: string; code?: string }>) => {
  const { findUserByUsername } = await import("../engine/control-plane/users.js");
  const { verifyPassword, createToken } = await import("../engine/control-plane/crypto.js");

  const user = await findUserByUsername(body.username);
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    return { error: "Invalid username or password." };
  }

  if (user.twofa_enabled) {
    const code = (body.code ?? "").trim();
    if (!code) return { requires2fa: true };
    const { verifyLoginCode } = await import("../engine/control-plane/twofa.js");
    const verified = await verifyLoginCode(user, code);
    if (!verified.ok) return { error: "Invalid username or password." };
  }

  const { setCookie } = await import("@mauroandre/velojs/cookie");
  setCookie(c!, "session", createToken({ id: user.id }), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });
  return { ok: true };
};

export const Component = () => {
  const [error, setError] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const res = (await action_login({
      body: {
        username: String(data.get("username") ?? ""),
        password: String(data.get("password") ?? ""),
        code: String(data.get("code") ?? ""),
      },
    })) as { ok?: boolean; error?: string; requires2fa?: boolean };
    if (res.requires2fa) {
      // Credenciais corretas, fator ativo: mesma página, campo de código.
      setError("");
      setNeedsCode(true);
      return;
    }
    if (res.error) {
      setError(res.error);
      return;
    }
    window.location.href = "/";
  };

  return (
    <main class={css.page}>
      <form class={css.card} onSubmit={onSubmit}>
        <div class={css.brand}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M4 7c5 0 7 10 16 10" stroke="#2F6FEB" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M4 17c5 0 7-10 16-10" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span>Weave</span>
        </div>
        <p class={css.subtitle}>Admin panel</p>

        <input class={css.input} name="username" placeholder="username" autoComplete="username" />
        <input
          class={css.input}
          name="password"
          type="password"
          placeholder="password"
          autoComplete="current-password"
        />
        {needsCode ? (
          <>
            <input
              class={css.input}
              name="code"
              placeholder="6-digit code or recovery code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
            <p class={css.subtitle}>Enter the code from your authenticator app (or a recovery code).</p>
          </>
        ) : null}
        <button class={css.button} type="submit">
          Sign in
        </button>
        {error ? (
          <p class={css.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
};
