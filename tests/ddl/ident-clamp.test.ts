import { describe, it, expect } from "vitest";
import { indexName, fkConstraintName, compositeIndexName, ownedChildTable, joinTableName } from "@mauroandre/weave-core";

// Limite de 63 chars do Postgres (NAMEDATALEN-1): identificadores gerados que estouram
// eram truncados em silêncio e colidiam (owned aninhado sob nome longo). Agora clampam com
// hash estável. Duas formas, cada uma no separador nativo:
//   - índice/constraint (folha, `_`) → `<coluna>_<hash(tabela)>_<tipo>`
//   - tabela (caminho, `__`)         → `<root>__<hash(caminho)>__<leaf>`

const LONG = "paths_applied__rating_assessments__statements"; // 45 chars, cabe

describe("clamp de índice / constraint (folha, separador _)", () => {
  it("no-op quando cabe (fica idêntico)", () => {
    expect(indexName("users", "email")).toBe("users_email_idx");
    expect(fkConstraintName("users", "city_id")).toBe("users_city_id_fkey");
    expect(compositeIndexName("orders", ["a", "b"], true)).toBe("orders_a_b_key");
  });

  it("estoura → <coluna>_<hash>_<tipo>: ≤63, sem leading, mantém coluna e sufixo", () => {
    const idx = indexName(LONG, "assessments_id"); // natural = 64
    expect(idx.length).toBeLessThanOrEqual(63);
    expect(idx.startsWith("_")).toBe(false); // sem leading separator
    expect(idx.startsWith("assessments_id_")).toBe(true); // coluna legível
    expect(idx.endsWith("_idx")).toBe(true); // tipo preservado
    expect(fkConstraintName(LONG, "assessments_id").endsWith("_fkey")).toBe(true);
  });

  it("determinístico (mesmo input → mesmo nome, estável entre pushes)", () => {
    expect(indexName(LONG, "assessments_id")).toBe(indexName(LONG, "assessments_id"));
  });

  it("par que colidiria no truncamento ingênuo → nomes DISTINTOS", () => {
    // mesmos primeiros 63 chars, diferem só depois → o Postgres truncaria pro mesmo nome
    const t = "billing__subscriptions__invoices__line_items__adjustments";
    const a = indexName(t, "discount_reason_id");
    const b = indexName(t, "discount_source_id");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(b.length).toBeLessThanOrEqual(63);
  });

  it("patológico (coluna gigante que sozinha estoura) ainda cabe em 63", () => {
    const hugeCol = "x".repeat(80);
    expect(indexName("t", hugeCol).length).toBeLessThanOrEqual(63);
  });
});

describe("clamp de tabela (caminho, separador __)", () => {
  it("no-op quando cabe (fica idêntico)", () => {
    expect(ownedChildTable("users", "addresses")).toBe("users__addresses");
    expect(ownedChildTable(LONG, "criteria")).toBe(`${LONG}__criteria`); // 55, cabe
  });

  it("estoura → <root>__<hash>__<leaf>: ≤63, sem leading, mantém entity e owned leaf", () => {
    const deep = "paths_applied__rating_assessments__statements__criteria__thresholds"; // 67
    const t = ownedChildTable(deep, "adjustments"); // natural = 80
    expect(t.length).toBeLessThanOrEqual(63);
    expect(t.startsWith("paths_applied__")).toBe(true); // root (entity)
    expect(t.endsWith("__adjustments")).toBe(true); // leaf (owned) — a FK do filho deriva daqui
    expect(t.startsWith("_")).toBe(false);
  });

  it("mesmo root + mesmo leaf, MEIO diferente → nomes DISTINTOS (o hash do caminho todo distingue)", () => {
    const p1 = "paths_applied__rating_assessments__statements__criteria";
    const p2 = "paths_applied__score_breakdowns__severity_levels__bands";
    const t1 = ownedChildTable(p1, "thresholds");
    const t2 = ownedChildTable(p2, "thresholds");
    expect(t1).not.toBe(t2); // ← a viagem do Mauro: não colide
    expect(t1.startsWith("paths_applied__") && t1.endsWith("__thresholds")).toBe(true);
    expect(t2.startsWith("paths_applied__") && t2.endsWith("__thresholds")).toBe(true);
  });

  it("override explícito NÃO é clampado (escolha do usuário)", () => {
    const long = "z".repeat(70);
    expect(ownedChildTable("whatever", "field", long)).toBe(long);
  });

  it("join table (N:N) clampa pela mesma regra", () => {
    const deep = "paths_applied__rating_assessments__statements__criteria__thresholds";
    expect(joinTableName(deep, "tags").length).toBeLessThanOrEqual(63);
  });
});
