import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";

// Data layer do dashboard da Home: contagens de objetos/tabelas por entity + a "sala
// de máquinas" do Postgres. Roda contra o banco real (é onde mora o risco: as queries).
// Robusto a entities deixadas por outros arquivos (o homeStats lista TODAS do metastore).

describe("homeStats — overview + engine room", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS homeplain, homeowned, homeowned__items, homepart CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('homeplain','homeowned','homepart')`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({ irVersion: 1, name: "homeplain", fields: { name: { kind: "column", type: "text", notNull: true } } });
        await applyEntity({
          irVersion: 1,
          name: "homeowned",
          fields: {
            title: { kind: "column", type: "text", notNull: true },
            items: { kind: "owned", array: true, shape: { sku: { kind: "column", type: "text", notNull: true } } },
          },
        });
        await applyEntity({
          irVersion: 1,
          name: "homepart",
          fields: {
            host: { kind: "column", type: "text", notNull: true },
            ts: { kind: "column", type: "timestamptz", notNull: true },
          },
          partitionBy: { field: "ts", interval: "1d" },
          retention: "30d",
        });
        // Semeia: 3 em homeplain; 2 dias em homepart (→ 2 partições).
        await sql`INSERT INTO homeplain (name) VALUES ('a'), ('b'), ('c')`;
        const day = 86_400_000;
        const t0 = new Date(Math.floor(Date.now() / day) * day + 3_600_000);
        const t1 = new Date(t0.getTime() - day);
        const { createManyObjects } = await import("../app/engine/control-plane/data.js");
        await createManyObjects("homepart", [
          { host: "api", ts: t0 },
          { host: "api", ts: t1 },
        ]);
      },
      getSessionCookie: async ({ user }) => {
        const { createToken } = await import("../app/engine/control-plane/crypto.js");
        return { session: createToken(user as { id: string }) };
      },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("conta objetos e tabelas por entity (owned e partição contam no total físico)", async () => {
    const { homeStats } = await import("../app/engine/control-plane/home.js");
    const s = await homeStats();
    const by = (name: string) => s.entities.find((e) => e.name === name)!;

    expect(by("homeplain").objects).toBe(3);
    expect(by("homeplain").tables).toBe(1); // só a raiz
    expect(by("homeplain").fields).toBe(1); // name
    expect(by("homeplain").size).toMatch(/\d/); // tamanho formatado (ex.: "16 kB")

    expect(by("homeowned").tables).toBe(2); // raiz + tabela do owned
    expect(by("homeowned").fields).toBe(2); // title + items (owned conta como 1 campo)

    const part = by("homepart");
    expect(part.partitioned).toBe(true);
    expect(part.objects).toBe(2);
    expect(part.fields).toBe(2); // host + ts
    expect(part.tables).toBe(3); // raiz + 2 partições (2 dias)
    expect(part.size).toMatch(/\d/); // soma raiz + partições

    // baseline name asc: homeowned < homepart < homeplain (o client reordena por clique)
    const idx = (n: string) => s.entities.findIndex((e) => e.name === n);
    expect(idx("homeowned")).toBeLessThan(idx("homepart"));
    expect(idx("homepart")).toBeLessThan(idx("homeplain"));
  });

  it("engine room do Postgres: versão, tamanho, tabelas, uptime, conexões", async () => {
    const { homeStats } = await import("../app/engine/control-plane/home.js");
    const s = await homeStats();
    expect(s.postgres.version).toMatch(/^PostgreSQL \d+/);
    expect(s.postgres.size).toMatch(/\d/); // ex.: "9.2 MB"
    expect(s.postgres.database).toBeTruthy();
    expect(s.postgres.tables).toBeGreaterThanOrEqual(3);
    expect(s.postgres.connections).toBeGreaterThanOrEqual(1);
    expect(s.postgres.uptime).not.toBe("—");
    // totais coerentes
    expect(s.totals.entities).toBeGreaterThanOrEqual(3);
    expect(s.totals.objects).toBeGreaterThanOrEqual(5); // 3 + 2 (no mínimo)
  });
});
