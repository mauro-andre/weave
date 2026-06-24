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
    return { error: "Usuário ou senha inválidos." };
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
    <main class={css.main}>
      <h1>Weave</h1>
      <form onSubmit={onSubmit} class={css.form}>
        <input name="username" placeholder="usuário" autoComplete="username" class={css.input} />
        <input
          name="password"
          type="password"
          placeholder="senha"
          autoComplete="current-password"
          class={css.input}
        />
        <button type="submit" class={css.button}>
          Entrar
        </button>
        {error ? (
          <p role="alert" class={css.error}>
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
};
