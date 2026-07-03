import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";
import { createClient, defineEntity, int8, text } from "@mauroandre/weave-sdk";

// int8 (bigint-backed) de ponta a ponta. Antes: escrever int8 pelo SDK era impossível
// — o tipo exigia bigint e `JSON.stringify(bigint)` lança. Agora o valor de escrita é
// number|bigint e o SDK coage bigint→number no fio; `.default(0)` também funciona.
const rec = defineEntity("bigrec", {
  label: text().notNull(),
  size: int8().notNull().default(0),
});
const entities = { bigrec: rec };

describe("SDK int8 — write com number e bigint + default", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  const weave = () =>
    createClient({ url: "http://localhost", key: process.env.WEAVE_API_KEY!, entities, fetch: (r) => app.hono.fetch(r) });

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        await db()`DROP TABLE IF EXISTS bigrec CASCADE`;
        await db()`DELETE FROM weave_entities WHERE name = 'bigrec'`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "bigrec",
          fields: {
            label: { kind: "column", type: "text", notNull: true },
            size: { kind: "column", type: "int8", notNull: true, default: 0 },
          },
        });
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

  it("create com number no int8 (era impossível antes)", async () => {
    const row = await weave().bigrec.create({ label: "a", size: 5 });
    expect(Number(row.size)).toBe(5);
  });

  it("create com bigint no int8 (SDK coage p/ number no fio, não lança)", async () => {
    const row = await weave().bigrec.create({ label: "b", size: 10n });
    expect(Number(row.size)).toBe(10);
  });

  it("omitir o int8 usa o default(0)", async () => {
    const row = await weave().bigrec.create({ label: "c" });
    expect(Number(row.size)).toBe(0);
  });
});
