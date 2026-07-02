import { describe, it, expectTypeOf } from "vitest";
import {
  defineEntity,
  text,
  bool,
  type InferWhere,
  type InferPatch,
  type InferOrderBy,
} from "@mauroandre/weave-sdk";

// O gap de DX do PodCubo: tipar helpers de service (`getUser(where)`, `updateUser(where,
// patch)`) sem `as never` nem `Parameters<>`. Os aliases InferWhere/InferPatch/InferOrderBy
// exportados fecham isso. Testes de TIPO (atribuição a const tipado = tipagem contextual).

const user = defineEntity("users", {
  name: text().notNull(),
  email: text().notNull().unique(),
  verified: bool().default(false),
  verifyCode: text(), // nullable — pode virar null no patch
});

type UserWhere = InferWhere<typeof user>;
type UserPatch = InferPatch<typeof user>;
type UserOrder = InferOrderBy<typeof user>;

describe("SDK query type aliases (o gap de DX do PodCubo)", () => {
  it("InferWhere: shorthand, operadores e or/and", () => {
    const w1: UserWhere = { email: "a@b.com" }; // shorthand (eq)
    const w2: UserWhere = { email: { ilike: "%b%" } }; // operadores
    const w3: UserWhere = { or: [{ email: "x" }, { name: "y" }] }; // boolean
    void [w1, w2, w3];
  });

  it("InferPatch: parcial, inclusive setar nullable pra null", () => {
    const p1: UserPatch = { verified: true }; // parcial
    const p2: UserPatch = { verified: true, verifyCode: null }; // o caso do verifyEmail
    const p3: UserPatch = {}; // tudo opcional
    void [p1, p2, p3];
  });

  it("InferOrderBy: por campo (asc|desc)", () => {
    const o1: UserOrder = { email: "asc" };
    const o2: UserOrder = { createdAt: "desc" }; // campo gerenciado
    void [o1, o2];
  });

  it("helpers de service tipados na fronteira, sem as never / Parameters<>", () => {
    const getUser = (where: UserWhere) => where;
    const updateUser = (where: UserWhere, patch: UserPatch) => [where, patch] as const;
    getUser({ email: "a@b.com" });
    updateUser({ verifyCode: "tok" }, { verified: true, verifyCode: null });
    expectTypeOf(updateUser).parameter(1).toEqualTypeOf<UserPatch>();
  });
});
