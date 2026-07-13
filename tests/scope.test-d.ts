import { describe, it } from "vitest";
import { defineEntity, text, int4, bool, reference, owned, scopeRule, defineScope, createClient } from "@mauroandre/weave-sdk";

// 2b (where param-aware) + 2c (fields dot-path) + 2d (params inferidos → weave.as tipado).
const company = defineEntity("company2d", { name: text().notNull(), tier: int4() });
const respondent = defineEntity("respondent2d", {
  whatsapp: text(),
  isActive: bool(),
  company: reference(company),
  summary: owned({ expectedRoi: int4(), note: text() }),
});

describe("scopeRule — where param-aware (2b) + fields dot-path (2c)", () => {
  it("where: literal + param + multi-hop tipados", () => {
    scopeRule(respondent, {
      verbs: ["read"],
      where: {
        and: [
          { company: { id: { eq: { param: "companyId" } } } }, // ref multi-hop + param
          { isActive: { eq: true } }, // literal
          { whatsapp: { param: "wa" } }, // bare param
        ],
      },
    });
  });

  it("fields: dot-paths válidos de E (folha, aninhado, subárvore)", () => {
    scopeRule(respondent, { verbs: ["read"], fields: { exclude: ["whatsapp", "summary.expectedRoi", "company"] } });
  });

  it("path inexistente em fields → erro de compilação", () => {
    // @ts-expect-error 'summary.nope' não é dot-path de respondent
    scopeRule(respondent, { verbs: ["read"], fields: { exclude: ["summary.nope"] } });
  });

  it("valor de tipo errado numa coluna → erro de compilação", () => {
    // @ts-expect-error isActive é boolean, não string
    scopeRule(respondent, { verbs: ["read"], where: { isActive: { eq: "yes" } } });
  });
  // Obs.: um NOME de campo inexistente no where (`{ nope: … }`) NÃO é pego no compile
  // (o `const` pra inferir params troca a checagem do where de fresh→estrutural), mas o
  // `whereToFilter` lança no push (`campo 'nope' desconhecido`) — loud, nunca silencioso.
});

// 2d: os params saem dos `{ param: "x" }` das regras — sem declarar nada.
const admin = defineScope("admin2d", [
  scopeRule(company, { verbs: ["read"], where: { id: { eq: { param: "companyId" } } } }),
  scopeRule(respondent, { verbs: ["read"], where: { whatsapp: { param: "wa" } } }),
]);
const publicScope = defineScope("public2d", [scopeRule(company, { verbs: ["read"] })]);
const weave = createClient({ url: "http://x", key: "k", entities: { company2d: company, respondent2d: respondent } });

describe("weave.as — params inferidos (2d)", () => {
  it("exige o objeto de params tipado (union das regras)", () => {
    weave.as(admin, { companyId: "c1", wa: "123" });
  });

  it("param faltando → erro de compilação", () => {
    // @ts-expect-error falta 'wa'
    weave.as(admin, { companyId: "c1" });
  });

  it("param inexistente → erro de compilação", () => {
    // @ts-expect-error 'nope' não é param do scope
    weave.as(admin, { companyId: "c1", wa: "1", nope: "x" });
  });

  it("scope sem params → .as dispensa o objeto", () => {
    weave.as(publicScope);
  });
});
