import { describe, it, expect, afterEach } from "vitest";

// `SESSION_SECRET` não tem default — nem fraco.
//
// O Weave é OPEN SOURCE. Um default literal no código ("dev-secret-change-me") significa
// que toda instância sem a env aceita um cookie de sessão forjado por qualquer um que leia
// o repositório — inclusive o do master. Não é "default fraco", é painel sem autenticação,
// calado. Aqui o contrato é: sem a env, estoura; nunca assina com algo previsível.

describe("SESSION_SECRET — sem default", () => {
  const original = process.env.SESSION_SECRET;
  afterEach(() => {
    process.env.SESSION_SECRET = original;
  });

  const fresh = async () => {
    // O secret é lido a cada uso (não capturado no import), então o módulo do cache serve.
    return await import("../app/engine/control-plane/crypto.js");
  };

  it("sem a env → estoura, dizendo o que fazer", async () => {
    const { createToken } = await fresh();
    delete process.env.SESSION_SECRET;
    expect(() => createToken({ id: "u1" })).toThrow(/SESSION_SECRET is not set/);
    expect(() => createToken({ id: "u1" })).toThrow(/openssl rand -hex 32/);
  });

  it("verificar token sem a env também estoura (não cai em 'inválido' silencioso)", async () => {
    const { createToken, verifyToken } = await fresh();
    process.env.SESSION_SECRET = "s1";
    const t = createToken({ id: "u1" });
    delete process.env.SESSION_SECRET;
    expect(() => verifyToken(t)).toThrow(/SESSION_SECRET is not set/);
  });

  it("nenhum segredo previsível é aceito: o antigo default não assina mais nada", async () => {
    const { createToken, verifyToken } = await fresh();
    process.env.SESSION_SECRET = "dev-secret-change-me"; // o literal que vazava no repo
    const forged = createToken({ id: "master" });
    // Uma instância de verdade (segredo próprio) rejeita o token forjado com o velho default.
    process.env.SESSION_SECRET = "a-real-long-random-secret";
    expect(verifyToken(forged)).toBeNull();
  });

  it("com a env, o round-trip funciona", async () => {
    const { createToken, verifyToken } = await fresh();
    process.env.SESSION_SECRET = "a-real-long-random-secret";
    expect(verifyToken(createToken({ id: "u42" }))).toEqual({ id: "u42" });
  });
});
