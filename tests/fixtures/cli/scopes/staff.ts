import { defineScope } from "@mauroandre/weave-sdk";

export default defineScope("clistaff", {
  cliprod: {
    verbs: ["read"],
    where: { name: { ilike: "%a%" } },
    fields: { exclude: ["price"] },
  },
});
