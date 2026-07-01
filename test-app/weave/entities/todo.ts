import { defineEntity, bool, int4, reference, text } from "@mauroandre/weave-sdk";
import list from "./list.js";

export default defineEntity("todo", {
  title: text().notNull().$id("15ce0c15-a2fa-4435-bd1d-2f18bd227ca3"),
  done: bool().default(false).$id("d9db4c8c-e06e-4a78-8038-6a203b06a698"),
  list: reference(list).$id("fdd37d3a-aab7-4b2a-9821-0482b9f5ae23"),
  // newField3: int4().notNull().$id("f3179456-d3e2-4637-9747-7929aa758a3c"),
});
