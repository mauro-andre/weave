import { it } from "vitest";
import { faker } from "@faker-js/faker";
import { action_saveEntity } from "../app/pages/Entities.js";
import { action_saveObject } from "../app/pages/Data.js";

// Seed de cenário: uma loja (e-commerce) bem populada, criada 100% pelas ACTIONS
// (mesmo caminho da GUI) — nada de SQL cru. Roda via `npm run seed`. Contagens
// configuráveis por env (defaults pesados: 500+ produtos, 600+ pedidos).
const num = (key: string, def: number) => Number(process.env[key] ?? def);
const USERS = num("SEED_USERS", 200);
const PRODUCTS = num("SEED_PRODUCTS", 500);
const ORDERS = num("SEED_ORDERS", 600);
const CATEGORY_NAMES = ["Electronics", "Books", "Home", "Toys", "Garden", "Sports", "Beauty", "Grocery"];
const WAREHOUSES = ["SP", "RJ", "MG", "RS", "PR"];

const pad = (n: number) => String(n).padStart(5, "0");

it(
  "popula o cenário de e-commerce via actions",
  async () => {
    faker.seed(42); // reprodutível
    const { setup } = await import("../app/engine/control-plane/setup.js");
    await setup(); // recria control-plane (o globalSetup acabou de zerar tudo)

    const define = async (ir: unknown) => {
      const res = (await action_saveEntity({ body: { ir } })) as { error?: string };
      if (res.error) throw new Error(`entity: ${res.error}`);
    };
    const create = async (name: string, object: Record<string, unknown>): Promise<string> => {
      const res = (await action_saveObject({ body: { name, object } })) as {
        object?: { id: string };
        error?: string;
      };
      if (res.error || !res.object) throw new Error(`${name}: ${res.error ?? "no object returned"}`);
      return res.object.id;
    };

    // ── Entidades (owned, mirror, references, default, unique) ────────────────
    await define({ irVersion: 1, name: "category", fields: { name: { kind: "column", type: "text", notNull: true, unique: true } } });
    await define({
      irVersion: 1,
      name: "users",
      fields: {
        name: { kind: "column", type: "text", notNull: true },
        email: { kind: "column", type: "text", notNull: true, unique: true },
        phone: { kind: "column", type: "text" },
        addresses: {
          kind: "owned",
          array: true,
          shape: {
            street: { kind: "column", type: "text" },
            city: { kind: "column", type: "text" },
            state: { kind: "column", type: "text" },
            zip: { kind: "column", type: "text" },
          },
        },
      },
    });
    await define({
      irVersion: 1,
      name: "products",
      fields: {
        name: { kind: "column", type: "text", notNull: true },
        sku: { kind: "column", type: "text", notNull: true, unique: true },
        price: { kind: "column", type: "int4", notNull: true },
        description: { kind: "column", type: "text" },
        category: { kind: "reference", target: "category", cardinality: "one" },
      },
    });
    await define({
      irVersion: 1,
      name: "orders",
      fields: {
        code: { kind: "column", type: "text", notNull: true, unique: true },
        status: { kind: "column", type: "text", default: "pending" },
        total: { kind: "column", type: "int4" },
        user: { kind: "reference", target: "users", cardinality: "one" },
        // itens espelham `product` + campos locais (snapshot do pedido).
        items: {
          kind: "owned",
          array: true,
          mirror: "products",
          shape: {
            quantity: { kind: "column", type: "int4", notNull: true },
            lineTotal: { kind: "column", type: "int4" },
          },
        },
      },
    });
    // Estoque por (produto, depósito): UNIQUE composto (um registro por combinação) +
    // INDEX composto não-único (varredura "estoque baixo por depósito"). Membro reference.
    await define({
      irVersion: 1,
      name: "inventory",
      fields: {
        warehouse: { kind: "column", type: "text", notNull: true },
        product: { kind: "reference", target: "products", cardinality: "one" },
        quantity: { kind: "column", type: "int4", notNull: true },
      },
      unique: [["product", "warehouse"]],
      index: [["warehouse", "quantity"]],
    });
    // Avaliação por (produto, usuário): UNIQUE composto (uma por usuário por produto) +
    // INDEX composto não-único ("melhores avaliados por produto"). Dois membros reference.
    await define({
      irVersion: 1,
      name: "review",
      fields: {
        product: { kind: "reference", target: "products", cardinality: "one" },
        user: { kind: "reference", target: "users", cardinality: "one" },
        rating: { kind: "column", type: "int4", notNull: true },
        title: { kind: "column", type: "text" },
        body: { kind: "column", type: "text" },
      },
      unique: [["product", "user"]],
      index: [["product", "rating"]],
    });

    // ── Dados ─────────────────────────────────────────────────────────────────
    const categoryIds: string[] = [];
    for (const name of CATEGORY_NAMES) categoryIds.push(await create("category", { name }));

    const userIds: string[] = [];
    for (let i = 0; i < USERS; i++) {
      const addresses = Array.from({ length: faker.number.int({ min: 1, max: 3 }) }, () => ({
        street: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state(),
        zip: faker.location.zipCode(),
      }));
      userIds.push(
        await create("users", {
          name: faker.person.fullName(),
          email: `${faker.internet.username().toLowerCase()}${i}@example.com`,
          phone: faker.phone.number(),
          addresses,
        }),
      );
      if ((i + 1) % 50 === 0) console.log(`users: ${i + 1}/${USERS}`);
    }

    const products: { id: string; name: string; sku: string; price: number; categoryId: string }[] = [];
    for (let i = 0; i < PRODUCTS; i++) {
      const name = faker.commerce.productName();
      const sku = `SKU-${pad(i)}`;
      const price = Math.round(Number(faker.commerce.price({ min: 5, max: 800 })));
      const categoryId = faker.helpers.arrayElement(categoryIds);
      const id = await create("products", {
        name,
        sku,
        price,
        description: faker.commerce.productDescription(),
        category: { id: categoryId },
      });
      products.push({ id, name, sku, price, categoryId });
      if ((i + 1) % 100 === 0) console.log(`products: ${i + 1}/${PRODUCTS}`);
    }

    for (let i = 0; i < ORDERS; i++) {
      const chosen = faker.helpers.arrayElements(products, faker.number.int({ min: 1, max: 5 }));
      const items = chosen.map((p) => {
        const quantity = faker.number.int({ min: 1, max: 4 });
        // snapshot do produto no item: inclui a category espelhada (reference dentro do owned).
        return { name: p.name, sku: p.sku, price: p.price, quantity, lineTotal: p.price * quantity, category: { id: p.categoryId } };
      });
      const total = items.reduce((s, it) => s + it.lineTotal, 0);
      await create("orders", {
        code: `ORD-${pad(i)}`,
        status: faker.helpers.arrayElement(["pending", "paid", "shipped", "cancelled"]),
        total,
        user: { id: faker.helpers.arrayElement(userIds) },
        items,
      });
      if ((i + 1) % 100 === 0) console.log(`orders: ${i + 1}/${ORDERS}`);
    }

    // Estoque: 1–3 depósitos DISTINTOS por produto (arrayElements garante distintos →
    // respeita o unique [product, warehouse]).
    let invCount = 0;
    for (const p of products) {
      const whs = faker.helpers.arrayElements(WAREHOUSES, faker.number.int({ min: 1, max: 3 }));
      for (const wh of whs) {
        await create("inventory", { warehouse: wh, product: { id: p.id }, quantity: faker.number.int({ min: 0, max: 500 }) });
        invCount++;
      }
      if (invCount % 200 === 0) console.log(`inventory: ${invCount}`);
    }

    // Avaliações: 0–5 usuários DISTINTOS por produto (respeita o unique [product, user]).
    let revCount = 0;
    for (const p of products) {
      const reviewers = faker.helpers.arrayElements(userIds, faker.number.int({ min: 0, max: 5 }));
      for (const uid of reviewers) {
        await create("review", {
          product: { id: p.id },
          user: { id: uid },
          rating: faker.number.int({ min: 1, max: 5 }),
          title: faker.commerce.productAdjective(),
          body: faker.lorem.sentence(),
        });
        revCount++;
      }
      if (revCount % 200 === 0) console.log(`reviews: ${revCount}`);
    }

    console.log(
      `✓ seeded: ${categoryIds.length} categories, ${userIds.length} users, ${products.length} products, ${ORDERS} orders, ${invCount} inventory, ${revCount} reviews`,
    );

    const { closeDb } = await import("../app/engine/control-plane/db.js");
    await closeDb();
  },
  600_000,
);
