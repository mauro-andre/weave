import { defineEntity, text } from "@mauroandre/weave-sdk";

export default defineEntity("clicat", { name: text().notNull() });
