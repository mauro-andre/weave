// GERADO por `weave gen` — não edite à mão. Uso server-side (a key é segredo).
import { createClient } from "@mauroandre/weave-sdk";
import * as entities from "./entities/index.js";

export const weave = createClient({
  url: process.env.WEAVE_URL!,
  key: process.env.WEAVE_KEY!,
  entities,
});
