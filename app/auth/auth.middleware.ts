import { createMiddleware } from "@mauroandre/velojs/factory";
import { getCookie } from "@mauroandre/velojs/cookie";
import { verifyToken } from "../engine/control-plane/crypto.js";

// Protege tudo sob o AdminLayout. Sem sessão válida: redireciona GET pro /login,
// 401 nas demais (actions/data). Casca fina: delega o verify ao engine.
export const authMiddleware = createMiddleware(async (c, next) => {
  const session = verifyToken(getCookie(c, "session"));
  if (!session) {
    if (c.req.method === "GET") return c.redirect("/login");
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", session);
  await next();
});
