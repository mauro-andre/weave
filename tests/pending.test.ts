import { describe, it, expect, beforeAll, afterAll } from "vitest";

// applyProject — o motor do push de projeto: aplica um conjunto de entidades e PERSISTE
// o pending (slot único) com o que ficou retido. Convergiu → limpa. É a fundação do
// pushAll (boot) e da resolução na GUI. Roda no control-plane, contra o banco real.

describe("applyProject + pending (slot único)", () => {
  beforeAll(async () => {
    const { setup } = await import("../app/engine/control-plane/setup.js");
    await setup();
    const { db } = await import("../app/engine/control-plane/db.js");
    const sql = db();
    await sql`DROP TABLE IF EXISTS pj_clean, pj_b CASCADE`;
    await sql`DELETE FROM weave_entities WHERE name IN ('pj_clean','pj_b')`;
    await sql`DELETE FROM weave_pending`;

    const { applyEntity } = await import("../app/engine/control-plane/entities.js");
    await applyEntity({ irVersion: 1, name: "pjClean", fields: { name: { kind: "column", type: "text", notNull: true } } });
    await applyEntity({
      irVersion: 1,
      name: "pjB",
      fields: {
        name: { kind: "column", type: "text", notNull: true },
        old: { kind: "column", type: "text" },
      },
    });
    await sql`INSERT INTO pj_b (name, old) VALUES ('x', 'y')`; // dado → drop de `old` é destrutivo
  });

  afterAll(async () => {
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  const cleanDesired = {
    irVersion: 1,
    name: "pjClean",
    fields: { name: { kind: "column", type: "text", notNull: true }, tag: { kind: "column", type: "text" } }, // + tag (auto)
  };
  const bDropDesired = {
    irVersion: 1,
    name: "pjB",
    fields: { name: { kind: "column", type: "text", notNull: true } }, // remove `old` (confirm)
  };

  it("multi-entidade: a limpa aplica, a retida vira review + é persistida no pending", async () => {
    const { applyProject } = await import("../app/engine/control-plane/entities.js");
    const { getPending } = await import("../app/engine/control-plane/pending.js");

    const r = await applyProject([cleanDesired, bDropDesired]);

    expect(r.applied).toEqual(["pjClean"]); // o add subiu sozinho
    expect(r.review).toHaveLength(1); // o drop segurou
    expect(r.review[0]!.name).toBe("pjB");
    expect(r.review[0]!.plan.changes.some((c) => c.op === "removeField" && c.risk === "confirm")).toBe(true);

    // pending persistido, com o IR desejado (pra a GUI resolver)
    const p = await getPending();
    expect(p).not.toBeNull();
    expect(p!.entries).toHaveLength(1);
    expect(p!.entries[0]!.name).toBe("pjB");
    expect(p!.entries[0]!.ir).toMatchObject({ name: "pjB" });
    expect(p!.entries[0]!.plan.changes.length).toBeGreaterThan(0);
  });

  it("resolver com confirm aplica e LIMPA o slot", async () => {
    const { applyProject } = await import("../app/engine/control-plane/entities.js");
    const { getPending } = await import("../app/engine/control-plane/pending.js");

    const r = await applyProject([cleanDesired, bDropDesired], { confirm: { pjB: ["old"] } });

    expect(r.review).toEqual([]); // nada mais retido
    expect(r.applied).toContain("pjB"); // o drop entrou
    expect(await getPending()).toBeNull(); // slot limpo
  });
});
