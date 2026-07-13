import { describe, it } from "vitest";
import { defineEntity, text, int4, bool, reference, owned, scopeRule } from "@mauroandre/weave-sdk";

// 2b (where tipado param-aware) + 2c (fields como dot-path de E). Typo/rename num campo
// ou path viram ERRO DE COMPILAÇÃO — nunca falha de autorização silenciosa.
const company = defineEntity("company2d", { name: text().notNull(), tier: int4() });
const respondent = defineEntity("respondent2d", {
  whatsapp: text(),
  isActive: bool(),
  company: reference(company),
  summary: owned({ expectedRoi: int4(), note: text() }),
});

describe("scopeRule — where param-aware (2b) + fields dot-path (2c)", () => {
  it("where: literal + param se misturam, multi-hop tipado", () => {
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
    scopeRule(respondent, {
      verbs: ["read"],
      fields: { exclude: ["whatsapp", "summary.expectedRoi", "company"] },
    });
  });

  it("campo inexistente no where → erro de compilação", () => {
    scopeRule(respondent, {
      verbs: ["read"],
      // @ts-expect-error 'nope' não é campo de respondent
      where: { nope: { eq: 1 } },
    });
  });

  it("path inexistente em fields → erro de compilação", () => {
    scopeRule(respondent, {
      verbs: ["read"],
      // @ts-expect-error 'summary.nope' não é dot-path de respondent
      fields: { exclude: ["summary.nope"] },
    });
  });

  it("valor de tipo errado numa coluna → erro de compilação", () => {
    scopeRule(respondent, {
      verbs: ["read"],
      // @ts-expect-error isActive é boolean, não string
      where: { isActive: { eq: "yes" } },
    });
  });
});
