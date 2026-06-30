import "dotenv/config";
import { createClient } from "@mauroandre/weave-sdk";
import list from "../weave/entities/list.js";
import todo from "../weave/entities/todo.js";

// O client tipado do Weave. Roda SÓ no servidor (loaders/actions) — a key é god-mode.
// Por isso este módulo é sempre importado via `await import()` dentro de loader/action.
export const weave = createClient({
  url: process.env.WEAVE_URL ?? "http://localhost:3100",
  key: process.env.WEAVE_KEY ?? "",
  entities: { list, todo },
});
