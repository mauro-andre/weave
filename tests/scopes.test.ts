import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp } from "@mauroandre/velojs/testing";
import routes from "../app/routes.js";

const KEY = { "x-api-key": "test-api-key" };
const scoped = (scope: string, params: Record<string, unknown>) => ({
  ...KEY,
  "x-weave-scope": scope,
  "x-weave-params": JSON.stringify(params),
});

describe("scopes (enforcement na API)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let companyIdFieldId = "";
  let costFieldId = "";

  beforeAll(async () => {
    app = await createTestApp({
      routes,
      bootstrap: async () => {
        const { setup } = await import("../app/engine/control-plane/setup.js");
        await setup();
        const { db } = await import("../app/engine/control-plane/db.js");
        const sql = db();
        await sql`DROP TABLE IF EXISTS purchase, box__items, box, emp, dept CASCADE`;
        await sql`DELETE FROM weave_entities WHERE name IN ('purchase', 'box', 'emp', 'dept')`;
        await sql`DELETE FROM weave_scopes WHERE name IN ('admin', 'manager', 'boxscope', 'deptscope')`;
        const { applyEntity } = await import("../app/engine/control-plane/entities.js");
        await applyEntity({
          irVersion: 1,
          name: "purchase",
          fields: {
            code: { kind: "column", type: "text" },
            total: { kind: "column", type: "int4" },
            cost: { kind: "column", type: "int4" },
            company_id: { kind: "column", type: "int4" },
          },
        });
        await applyEntity({
          irVersion: 1,
          name: "box",
          fields: {
            label: { kind: "column", type: "text" },
            items: {
              kind: "owned",
              array: true,
              shape: { name: { kind: "column", type: "text" }, secret: { kind: "column", type: "text" } },
            },
          },
        });
        await applyEntity({ irVersion: 1, name: "dept", fields: { company_id: { kind: "column", type: "int4" } } });
        await applyEntity({
          irVersion: 1,
          name: "emp",
          fields: {
            name: { kind: "column", type: "text" },
            dept: { kind: "reference", target: "dept", cardinality: "one" },
          },
        });
      },
    });

    const { getEntity } = await import("../app/engine/control-plane/entities.js");
    const ir = (await getEntity("purchase"))!;
    companyIdFieldId = ir.fields.company_id!.id!;
    costFieldId = ir.fields.cost!.id!;

    const { saveObject } = await import("../app/engine/control-plane/data.js");
    for (const [code, company] of [["P1", 1], ["P2", 1], ["P3", 1], ["P4", 2], ["P5", 2]] as const) {
      await saveObject("purchase", { code, total: 100, cost: 60, company_id: company });
    }

    const { saveScope } = await import("../app/engine/control-plane/scopes.js");
    // admin: lê só a própria empresa; esconde `cost` (por exclusão, por id).
    await saveScope({
      name: "admin",
      entities: {
        purchase: {
          verbs: ["read"],
          rows: { path: [companyIdFieldId], op: "equals", value: { param: "companyId" } },
          fields: { mode: "exclude", paths: [[costFieldId]] },
        },
      },
    });
    // manager: lê várias empresas (IN); sem projeção.
    await saveScope({
      name: "manager",
      entities: {
        purchase: {
          verbs: ["read"],
          rows: { path: [companyIdFieldId], op: "in", value: { param: "companyIds" } },
          fields: null,
        },
      },
    });

    // boxscope: esconde `secret` DENTRO do owned `items` (projeção aninhada).
    const boxIr = (await getEntity("box"))!;
    const itemsId = boxIr.fields.items!.id!;
    const secretId = (boxIr.fields.items as { shape: Record<string, { id?: string }> }).shape.secret!.id!;
    await saveObject("box", { label: "B1", items: [{ name: "x", secret: "s1" }, { name: "y", secret: "s2" }] });
    await saveScope({
      name: "boxscope",
      entities: {
        box: { verbs: ["read"], rows: null, fields: { mode: "exclude", paths: [[itemsId, secretId]] } },
      },
    });

    // deptscope: alcança `emp` cujo dept.company_id == :companyId (filtro ANINHADO).
    const empIr = (await getEntity("emp"))!;
    const deptRefId = empIr.fields.dept!.id!;
    const cidId = (await getEntity("dept"))!.fields.company_id!.id!;
    const d1 = ((await saveObject("dept", { company_id: 1 })) as { id: string }).id;
    const d2 = ((await saveObject("dept", { company_id: 2 })) as { id: string }).id;
    await saveObject("emp", { name: "e1", dept: { id: d1 } });
    await saveObject("emp", { name: "e2", dept: { id: d2 } });
    await saveObject("emp", { name: "e3", dept: { id: d1 } });
    await saveScope({
      name: "deptscope",
      entities: {
        emp: {
          verbs: ["read"],
          rows: { path: [deptRefId, cidId], op: "equals", value: { param: "companyId" } },
          fields: null,
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  });

  it("god (sem scope) vê tudo, com todos os campos", async () => {
    const res = await app.get("/api/purchase", { headers: KEY });
    const page = await res.json();
    expect(page.docsQuantity).toBe(5);
    expect(page.docs[0]).toHaveProperty("cost");
  });

  it("admin filtra por companyId e esconde cost", async () => {
    const res = await app.get("/api/purchase", { headers: scoped("admin", { companyId: 1 }) });
    const page = await res.json();
    expect(page.docsQuantity).toBe(3); // só empresa 1
    expect(page.docs[0]).not.toHaveProperty("cost"); // projeção exclude
    expect(page.docs[0]).toHaveProperty("code");
    expect(page.docs[0]).toHaveProperty("total");
  });

  it("manager lê várias empresas (IN)", async () => {
    expect((await (await app.get("/api/purchase", { headers: scoped("manager", { companyIds: [1, 2] }) })).json()).docsQuantity).toBe(5);
    expect((await (await app.get("/api/purchase", { headers: scoped("manager", { companyIds: [2] }) })).json()).docsQuantity).toBe(2);
  });

  it("verbo fora do scope → 403", async () => {
    const res = await app.post("/api/purchase", {
      headers: scoped("admin", { companyId: 1 }),
      body: { code: "X", total: 1, cost: 1, company_id: 1 },
    });
    expect(res.status).toBe(403);
  });

  it("scope inexistente → 403", async () => {
    const res = await app.get("/api/purchase", { headers: scoped("ghost", {}) });
    expect(res.status).toBe(403);
  });

  it("param faltando → 400", async () => {
    const res = await app.get("/api/purchase", { headers: { ...KEY, "x-weave-scope": "admin" } });
    expect(res.status).toBe(400);
  });

  it("filtro de linhas ANINHADO (emp via dept.company_id)", async () => {
    const res = await app.get("/api/emp", { headers: scoped("deptscope", { companyId: 1 }) });
    const page = await res.json();
    expect(page.docs.map((d: { name: string }) => d.name).sort()).toEqual(["e1", "e3"]);
  });

  it("projeção aninhada esconde campo dentro do owned", async () => {
    const res = await app.get("/api/box", { headers: scoped("boxscope", {}) });
    const page = await res.json();
    const item = page.docs[0].items[0];
    expect(item).toHaveProperty("name");
    expect(item).not.toHaveProperty("secret"); // escondido por id-path aninhado
  });

  it("🚩 renomear o campo NÃO quebra o scope (guardado por id)", async () => {
    // renomeia cost → expense, preservando o id do campo (rename de verdade).
    const { getEntity, applyEntity } = await import("../app/engine/control-plane/entities.js");
    const ir = (await getEntity("purchase"))!;
    const fields = { ...ir.fields };
    const costNode = fields["cost"]!;
    delete fields["cost"];
    fields["expense"] = costNode; // mesmo nó, mesmo id
    await applyEntity({ irVersion: 1, name: "purchase", fields });

    // god vê o campo já renomeado…
    const god = await (await app.get("/api/purchase", { headers: KEY })).json();
    expect(god.docs[0]).toHaveProperty("expense");
    expect(god.docs[0]).not.toHaveProperty("cost");

    // …e o admin continua escondendo (resolve o id → "expense").
    const adm = await (await app.get("/api/purchase", { headers: scoped("admin", { companyId: 1 }) })).json();
    expect(adm.docs[0]).not.toHaveProperty("expense");
    expect(adm.docs[0]).not.toHaveProperty("cost");
  });
});
