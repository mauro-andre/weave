// Entry do servidor (boot). Prepara o control plane: cria as tabelas weave_* e
// semeia o master a partir do .env, se ainda não existir.
import { setup } from "./engine/control-plane/setup.js";

await setup();
