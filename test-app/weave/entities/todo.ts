import { defineEntity, bool, reference, text } from "@mauroandre/weave-sdk";
import list from "./list.js";

export default defineEntity("todo", {
  title: text().notNull().$id("15ce0c15-a2fa-4435-bd1d-2f18bd227ca3"),
  done: bool().default(false).$id("d9db4c8c-e06e-4a78-8038-6a203b06a698"),
  list: reference(list).$id("fdd37d3a-aab7-4b2a-9821-0482b9f5ae23"),
});
