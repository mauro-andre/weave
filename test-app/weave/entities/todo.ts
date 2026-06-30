import { defineEntity, text, bool, reference } from "@mauroandre/weave-sdk";
import list from "./list.js";

// Uma tarefa, que aponta pra uma lista (reference N:1).
export default defineEntity("todo", {
  title: text().notNull(),
  done: bool().default(false),
  list: reference(list),
});
