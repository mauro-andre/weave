import { createMiddleware } from "@mauroandre/velojs/factory";

// Auth da API pública (god-mode v1): API key no header `x-api-key`. Aceita a
// master key do `.env` (bootstrap) OU uma chave gerenciada no banco (que carimba
// `last_used_at`). Identidade-por-requisição + scopes = G2 (depois).
export const apiKeyMiddleware = createMiddleware(async (c, next) => {
  const key = c.req.header("x-api-key");
  if (!key) return c.json({ error: "Missing API key." }, 401);
  if (process.env.WEAVE_API_KEY && key === process.env.WEAVE_API_KEY) {
    await next();
    return;
  }
  const { verifyApiKey } = await import("../engine/control-plane/api-keys.js");
  if (await verifyApiKey(key)) {
    await next();
    return;
  }
  return c.json({ error: "Invalid API key." }, 401);
});
