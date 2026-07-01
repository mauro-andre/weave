import { defineEntity, text } from "@mauroandre/weave-sdk";

export default defineEntity("list", {
  name: text().notNull().$id("bed5da40-d9fa-4cd2-ab84-7942fe407ead"),
  color: text().default("#12B886").$id("ec7e822a-d070-4f00-8ab0-05a10608bc91"),
});
