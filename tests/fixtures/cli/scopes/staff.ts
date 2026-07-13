import { defineScope, scopeRule } from "@mauroandre/weave-sdk";
import cliprod from "../entities/product.js";

export default defineScope("clistaff", [
  scopeRule(cliprod, {
    verbs: ["read"],
    where: { name: { ilike: "%a%" } },
    fields: { exclude: ["price"] },
  }),
]);
