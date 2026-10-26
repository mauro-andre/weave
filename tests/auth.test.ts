import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { action_login } from "../app/auth/Login.js";
import { action_2fa_begin, action_2fa_confirm, action_2fa_disable } from "../app/pages/Config.js";
import { base32Decode, totpAt, currentStep } from "../app/engine/control-plane/totp.js";

describe("auth", () => {
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

  describe("fundação do painel", () => {
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

  describe("TOTP 2FA", () => {
    // Usuário dedicado do 2FA — cidadão: coexiste com o master, não o toca.
    const OP_USERNAME = "twofa-op";
    const OP_PASSWORD = "twofa-op-pass";

    // Relógio CONGELADO: os passos TOTP (30s) ficam determinísticos — drift,
    // replay e janela não dependem de quando o relógio real bate na borda.
    const T0 = new Date("2026-10-26T12:00:00Z").getTime();
    let op: { id: string };
    let secret = "";
    let recoveryFirst: string[] = [];
    let recoverySecond: string[] = [];

    const loginAs = (password: string, code?: string) =>
      app.action(action_login, { body: { username: OP_USERNAME, password, code } });
    const login = (code?: string) => loginAs(OP_PASSWORD, code);

    const db = async () => (await import("../app/engine/control-plane/db.js")).db();

    beforeAll(async () => {
      const { setup } = await import("../app/engine/control-plane/setup.js");
      await setup();
      const { hashPassword } = await import("../app/engine/control-plane/crypto.js");
      const sql = await db();
      // Nasce limpo de 2FA (idempotente com rodadas anteriores do mesmo banco).
      await sql`INSERT INTO weave_users (username, password_hash) VALUES (${OP_USERNAME}, ${hashPassword(OP_PASSWORD)})
        ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash,
          twofa_secret = NULL, twofa_enabled = false, twofa_last_step = NULL, twofa_recovery = NULL`;
      const { findUserByUsername } = await import("../app/engine/control-plane/users.js");
      op = (await findUserByUsername(OP_USERNAME))!;
      vi.useFakeTimers({ toFake: ["Date"] }); // só o relógio — I/O real (postgres/fetch) segue vivo
      vi.setSystemTime(T0);
    });

    afterAll(() => vi.useRealTimers());

    it("algoritmo: casa com os vetores do RFC 6238 (HMAC-SHA1, 6 dígitos)", async () => {
      // Secret ASCII "12345678901234567890" em base32 — os vetores do próprio RFC.
      const rfcSecret = Buffer.from("12345678901234567890", "utf8");
      expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").toString("utf8")).toBe("12345678901234567890");
      expect(totpAt(rfcSecret, 0x0000000000000001)).toBe("287082"); // T = 59s
      expect(totpAt(rfcSecret, 0x00000000023523ec)).toBe("081804"); // T = 1111111109s
      expect(totpAt(rfcSecret, 0x00000000023523ed)).toBe("050471"); // T = 1111111111s
      expect(totpAt(rfcSecret, 0x000000000273ef07)).toBe("005924"); // T = 1234567890s
      expect(totpAt(rfcSecret, 0x000000000273ef08)).toBe("590587"); // passo +1 de 1234567890s (conferido por HMAC independente)
      // Janela ±1 no verify: aceita passo atual e adjacentes, recusa o de fora.
      const { verifyTotp } = await import("../app/engine/control-plane/totp.js");
      const now = T0;
      const step = currentStep(now);
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step), null, now)).toBe(step);
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 1), null, now)).toBe(step - 1);
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 1), null, now)).toBe(step + 1);
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 2), null, now)).toBeNull();
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 2), null, now)).toBeNull();
    });

    it("begin: secret de 32 chars base32, URI otpauth com issuer/username e QR SVG", async () => {
      const res = await app.as({ user: op }).action(action_2fa_begin, { body: {} });
      const json = await res.json();
      expect(json.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(json.otpauth).toBe(`otpauth://totp/Weave:${OP_USERNAME}?secret=${json.secret}&issuer=Weave`);
      expect(json.qrSvg).toMatch(/^<svg/);
      expect(json.qrSvg).toContain("viewBox");
      secret = json.secret;
    });

    it("pendente NÃO muda o login: sem código ainda entra (critério 3)", async () => {
      const res = await login();
      expect(await res.json()).toEqual({ ok: true });
      expect(res.cookies.session).toBeTruthy();
    });

    it("confirm com código do passo ANTERIOR ativa (drift −1) e mostra 10 recovery codes UMA vez", async () => {
      const code = totpAt(base32Decode(secret), currentStep(T0) - 1);
      const res = await app.as({ user: op }).action(action_2fa_confirm, { body: { code } });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.recoveryCodes).toHaveLength(10);
      for (const rc of json.recoveryCodes) expect(rc).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      recoveryFirst = json.recoveryCodes;
    });

    it("banco: secret cifrado e recovery apenas em hashes (critério 8)", async () => {
      const sql = await db();
      const rows = await sql`SELECT twofa_secret, twofa_enabled, twofa_recovery FROM weave_users WHERE username = ${OP_USERNAME}`;
      const row = rows[0] as unknown as { twofa_secret: string; twofa_enabled: boolean; twofa_recovery: string[] };
      expect(row.twofa_enabled).toBe(true);
      expect(row.twofa_secret.startsWith("v1.")).toBe(true);
      expect(row.twofa_secret).not.toContain(secret);
      expect(row.twofa_recovery).toHaveLength(10);
      for (const h of row.twofa_recovery) expect(h).toMatch(/^[0-9a-f]{64}$/);
      for (const rc of recoveryFirst) expect(JSON.stringify(row.twofa_recovery)).not.toContain(rc);
    });

    it("login com 2FA ativo: senha certa SEM código → requires2fa, nenhuma sessão", async () => {
      const res = await login();
      expect(await res.json()).toEqual({ requires2fa: true });
      expect(res.cookies.session).toBeFalsy();
    });

    it("login: senha certa + código ERRADO → erro genérico, sem cookie", async () => {
      const res = await login("000000");
      const json = await res.json();
      expect(json.error).toBe("Invalid username or password.");
      expect(json.requires2fa).toBeUndefined();
      expect(res.cookies.session).toBeFalsy();
    });

    it("login: senha ERRADA (com ou sem código) → idêntico ao comportamento de hoje", async () => {
      const withCode = await loginAs("wrong-password", totpAt(base32Decode(secret), currentStep(T0)));
      expect(await withCode.json()).toEqual({ error: "Invalid username or password." });
      expect(withCode.cookies.session).toBeFalsy();
      const bare = await loginAs("wrong-password");
      expect(await bare.json()).toEqual({ error: "Invalid username or password." });
      expect(bare.cookies.session).toBeFalsy();
    });

    it("login: senha + TOTP do passo atual → sessão como hoje (critério 4b)", async () => {
      const res = await login(totpAt(base32Decode(secret), currentStep(T0)));
      expect(await res.json()).toEqual({ ok: true });
      expect(res.cookies.session).toBeTruthy();
    });

    it("anti-replay: o MESMO código não vale duas vezes enquanto a janela o cobre", async () => {
      const again = await login(totpAt(base32Decode(secret), currentStep(T0)));
      expect(await again.json()).toEqual({ error: "Invalid username or password." });
      expect(again.cookies.session).toBeFalsy();
    });

    it("drift futuro: código do passo +1 é aceito na janela", async () => {
      const res = await login(totpAt(base32Decode(secret), currentStep(T0) + 1));
      expect(await res.json()).toEqual({ ok: true });
      expect(res.cookies.session).toBeTruthy();
    });

    it("recovery code: aceito UMA vez; o segundo uso do mesmo código falha", async () => {
      const first = await login(recoveryFirst[0]);
      expect(await first.json()).toEqual({ ok: true });
      expect(first.cookies.session).toBeTruthy();

      const replay = await login(recoveryFirst[0]);
      expect(await replay.json()).toEqual({ error: "Invalid username or password." });
      expect(replay.cookies.session).toBeFalsy();

      const second = await login(recoveryFirst[1]);
      expect(await second.json()).toEqual({ ok: true });
    });

    it("disable SEM código válido → recusado; a sessão sozinha não desliga o fator", async () => {
      const empty = await app.as({ user: op }).action(action_2fa_disable, { body: { code: "" } });
      expect((await empty.json()).ok).toBeFalsy();
      const wrong = await app.as({ user: op }).action(action_2fa_disable, { body: { code: "000000" } });
      expect((await wrong.json()).ok).toBeFalsy();
      // Continua ativo: login ainda exige código.
      expect(await (await login()).json()).toEqual({ requires2fa: true });
    });

    it("disable COM recovery code → desliga; login volta a ser senha-only", async () => {
      const res = await app.as({ user: op }).action(action_2fa_disable, { body: { code: recoveryFirst[2] } });
      expect(await res.json()).toEqual({ ok: true });
      const back = await login();
      expect(await back.json()).toEqual({ ok: true });
      expect(back.cookies.session).toBeTruthy();
    });

    it("re-enable: revoga TODOS os recovery anteriores e gera novos", async () => {
      vi.setSystemTime(T0 + 61_000); // novo passo — o secret é novo, mas tempo andou
      const begin = await app.as({ user: op }).action(action_2fa_begin, { body: {} });
      const pending = await begin.json();
      expect(pending.secret).not.toBe(secret);
      secret = pending.secret;

      const confirm = await app
        .as({ user: op })
        .action(action_2fa_confirm, { body: { code: totpAt(base32Decode(secret), currentStep()) } });
      const json = await confirm.json();
      expect(json.ok).toBe(true);
      recoverySecond = json.recoveryCodes;

      // Recovery do PRIMEIRO lote foi revogado com o re-enable.
      const old = await login(recoveryFirst[3]);
      expect(await old.json()).toEqual({ error: "Invalid username or password." });
      // O novo lote funciona.
      const fresh = await login(recoverySecond[0]);
      expect(await fresh.json()).toEqual({ ok: true });
    });

    it("restart (setup de novo): migração idempotente e o estado do 2FA sobrevive", async () => {
      const { setup } = await import("../app/engine/control-plane/setup.js");
      await setup(); // o que o boot faz a cada start do servidor
      const sql = await db();
      const rows = await sql`SELECT twofa_enabled, twofa_secret FROM weave_users WHERE username = ${OP_USERNAME}`;
      expect((rows[0] as unknown as { twofa_enabled: boolean }).twofa_enabled).toBe(true);
      expect((rows[0] as unknown as { twofa_secret: string | null }).twofa_secret).toBeTruthy();
      // E o login continua exigindo código.
      expect(await (await login()).json()).toEqual({ requires2fa: true });
    });

    it("GUI: /settings com sessão renderiza o card; sem sessão → /login; /login pública", async () => {
      const authed = await app.as({ user: op }).get("/settings");
      expect(authed.status).toBe(200);
      expect(await authed.text()).toContain("Two-factor authentication");
      const anon = await app.get("/settings");
      expect(anon.status).toBe(302);
      expect(anon.headers.location).toBe("/login");
      const loginPage = await app.get("/login");
      expect(loginPage.status).toBe(200);
    });
  });
});
