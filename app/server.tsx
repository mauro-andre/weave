// Entry do servidor (boot). Carrega o .env (o Vite não popula process.env sozinho)
// e prepara o control plane: cria as tabelas weave_* e semeia o master do .env.
import { config } from "dotenv";
config();

import { setup } from "./engine/control-plane/setup.js";

await setup();
