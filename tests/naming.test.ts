import { describe, it, expect } from "vitest";
import { camelize, camelToSnake, normalizeEntityIR } from "@mauroandre/weave-core";
import { compileFind, defineEntity, text } from "../app/engine/index.js";

// Nome de CAMPO = camelCase canônico (o nome lógico do dev). Nome de ENTIDADE = slug
// (vira tabela). A COLUNA no Postgres deriva do campo via camelToSnake (snake_case).

describe("camelize — qualquer estilo converge pro mesmo camelCase", () => {
  const cases: [string, string][] = [
    ["firstName", "firstName"],
    ["First Name", "firstName"],
    ["first_name", "firstName"],
    ["first-name", "firstName"],
    ["nome do campo", "nomeDoCampo"],
    ["nomeDoCampo", "nomeDoCampo"],
    ["Preço Médio", "precoMedio"], // acento some
    ["  espaços  extras ", "espacosExtras"],
    ["já_camel", "jaCamel"],
    ["2fast", "_2fast"], // identificador não começa com dígito
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => expect(camelize(input)).toBe(expected));
  }
});

describe("camelize → camelToSnake = coluna snake_case", () => {
  it("mapeia camelCase → snake_case", () => {
    expect(camelToSnake(camelize("First Name"))).toBe("first_name");
    expect(camelToSnake(camelize("nome do campo"))).toBe("nome_do_campo");
    expect(camelToSnake(camelize("phoneNumber"))).toBe("phone_number");
  });

  it("estilos diferentes → MESMO campo → MESMA coluna (convergência)", () => {
    const forms = ["firstName", "first_name", "First Name", "  first   name "];
    const fields = new Set(forms.map(camelize));
    expect(fields).toEqual(new Set(["firstName"]));
    expect(new Set([...fields].map(camelToSnake))).toEqual(new Set(["first_name"]));
  });
});

describe("where com campo camelCase → coluna snake_case no SQL", () => {
  const person = defineEntity("person", { firstName: text(), phoneNumber: text() });

  it("{ firstName: 'Ada' } (shorthand) filtra pela coluna first_name", () => {
    const { text: sql, params } = compileFind(person, { where: { firstName: "Ada" } });
    const line = sql.split("\n").find((l) => l.startsWith("WHERE")) ?? "";
    expect(line).toBe("WHERE person.first_name = $1");
    expect(params).toEqual(["Ada"]);
  });

  it("{ phoneNumber: { ilike } } → phone_number ILIKE", () => {
    const { text: sql } = compileFind(person, { where: { phoneNumber: { ilike: "%55%" } } });
    expect(sql).toContain("person.phone_number ILIKE");
  });

  it("orderBy por campo camelCase também vai pra coluna snake", () => {
    const { text: sql } = compileFind(person, { orderBy: { firstName: "desc" } });
    expect(sql).toContain("ORDER BY person.first_name DESC");
  });
});

describe("normalizeEntityIR — campo = camelize, entidade = slug", () => {
  it("entidade vira slug (tabela); campos viram camelCase", () => {
    const ir = normalizeEntityIR({
      irVersion: 1,
      name: "Pedidos Especiais",
      fields: {
        "First Name": { kind: "column", type: "text" },
        phoneNumber: { kind: "column", type: "text" },
      },
    } as never);
    expect(ir.name).toBe("pedidos_especiais");
    expect(Object.keys(ir.fields)).toEqual(["firstName", "phoneNumber"]);
  });

  it("owned aninhado também cameliza os campos internos", () => {
    const ir = normalizeEntityIR({
      irVersion: 1,
      name: "order",
      fields: {
        "Ship To": {
          kind: "owned",
          array: false,
          shape: { "street name": { kind: "column", type: "text" } },
        },
      },
    } as never);
    expect(Object.keys(ir.fields)).toEqual(["shipTo"]);
    const owned = ir.fields["shipTo"] as { shape: Record<string, unknown> };
    expect(Object.keys(owned.shape)).toEqual(["streetName"]);
  });
});
