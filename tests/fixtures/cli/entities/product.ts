import { defineEntity, text, int4, reference } from "@mauroandre/weave-sdk";
import category from "./category.js";

export default defineEntity("cliprod", {
  name: text().notNull(),
  price: int4(),
  category: reference(category),
});
