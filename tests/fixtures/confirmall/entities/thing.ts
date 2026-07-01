import { defineEntity, text } from "@mauroandre/weave-sdk";

// Placeholder — o teste injeta a definição via `load` (v1 com 3 campos, v2 com 1).
export default defineEntity("cathing", {
  keep: text().notNull(),
  dropA: text(),
  dropB: text(),
});
