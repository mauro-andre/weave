import { defineEntity, text, reference } from "../../../app/engine/index.js";
import lzCompany from "./lzCompany.js";

const lzUsers = defineEntity("lz_users", {
  email: text().notNull(),
  company: reference(() => lzCompany).notNull(), // users → company (notNull)
});
export default lzUsers;
