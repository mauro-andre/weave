import type { ActionArgs } from "@mauroandre/velojs";
import { useState } from "preact/hooks";
import * as css from "./Login.css.js";

export const action_login = async ({
  body,
  c,
}: ActionArgs<{ username: string; password: string }>) => {
  const { findUserByUsername } = await import("../engine/control-plane/users.js");
  const { verifyPassword, createToken } = await import("../engine/control-plane/crypto.js");

  const user = await findUserByUsername(body.username);
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    return { error: "Invalid username or password." };
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

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const res = await action_login({
      body: {
        username: String(data.get("username") ?? ""),
        password: String(data.get("password") ?? ""),
      },
    });
    if ((res as { error?: string }).error) {
      setError((res as { error: string }).error);
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
