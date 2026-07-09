import { defineEntity, text, reference } from "../../../app/engine/index.js";
import lzUsers from "./lzUsers.js";

// Ciclo mútuo REAL (import circular entre módulos), como o gen emitiria. O thunk
// `() => lzUsers` adia a resolução: no tipo o TS resolve circular sem degradar; no
// runtime o binding do ESM já está populado quando o thunk é chamado (no toIR).
const lzCompany = defineEntity("lz_company", {
  name: text().notNull(),
  consultant: reference(() => lzUsers), // company → users (nullable)
});
export default lzCompany;
