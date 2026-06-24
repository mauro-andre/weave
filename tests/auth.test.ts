import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_login } from "../app/auth/Login.js";

describe("auth — fundação do painel", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        // Estado limpo: recria a tabela e semeia o master a partir do .env de teste.
        const { db } = await import("../app/engine/control-plane/db.js");
        await db()`DROP TABLE IF EXISTS weave_users CASCADE`;
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("login com o master → ok + cookie de sessão", async () => {
    const res = await app.action(action_login, {
      body: { username: process.env.MASTER_USERNAME!, password: process.env.MASTER_PASSWORD! },
    });
    expect(await res.json()).toEqual({ ok: true });
    expect(res.cookies.session).toBeTruthy();
  });

  it("login com senha errada → erro, sem cookie", async () => {
    const res = await app.action(action_login, {
      body: { username: process.env.MASTER_USERNAME!, password: "errada" },
    });
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(res.cookies.session).toBeFalsy();
  });

  it("rota protegida sem sessão → redireciona /login", async () => {
    const res = await app.get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("rota protegida com sessão → 200", async () => {
    const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
    const master = await findUserByUsername(process.env.MASTER_USERNAME!);
    const res = await app.as({ user: master }).get("/");
    expect(res.status).toBe(200);
  });
});
