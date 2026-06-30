import { defineEntity, text } from "@mauroandre/weave-sdk";

// Uma lista de tarefas — nome e uma cor pra UI.
export default defineEntity("list", {
  name: text().notNull(),
  color: text().default("#12B886"),
});
