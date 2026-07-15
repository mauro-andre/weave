---
description: "Running the Weave server container, its required env vars, creating an API key, installing the SDK, and the first entity→push→query round-trip. Use when starting a new Weave project, connecting an app to Weave, standing up a local/CI server, or setting WEAVE_URL/WEAVE_KEY."
---
# Getting started

Weave is a code-first object abstraction over PostgreSQL. You design **entities**,
query them by **nesting objects**, and enforce access with **scopes** — and you
never write SQL. There are two pieces:

- **The server** — engine, dashboard and API in one container. It owns your
  entities, your data, and your access rules. It speaks SQL to Postgres so you
  don't have to.
- **The SDK** — `@mauroandre/weave-sdk`, a typed object client you install in your
  app to talk to the server over HTTP.

## Run the server

The server ships as a container image. Point it at a PostgreSQL database and a few
secrets:

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/db \
  -e MASTER_USERNAME=master \
  -e MASTER_PASSWORD=change-me \
  -e SESSION_SECRET=a-long-random-string \
  ghcr.io/mauro-andre/weave
```

Open `http://localhost:3000`, sign in with the master credentials, and you're in
the dashboard. Create an API key from the API page — you'll need it as `WEAVE_KEY`.

For automated or CI use you can also set `WEAVE_API_KEY` on the server — a fixed
god-mode key it accepts straight from the environment, no dashboard round-trip. It's
what a test suite authenticates with; see **[Testing](/docs/testing)**.

## Install the SDK

In your application:

```bash
npm install @mauroandre/weave-sdk
```

Set the connection in the environment:

```bash
export WEAVE_URL=http://localhost:3000
export WEAVE_KEY=<your api key>
```

## Your first query

```ts
import { createClient } from "@mauroandre/weave-sdk";
import { product, category } from "./weave/entities/index.js";

const weave = createClient({
  url: process.env.WEAVE_URL!,
  key: process.env.WEAVE_KEY!,
  entities: { product, category },
});

const cat = await weave.category.create({ name: "Books" });
const p = await weave.product.create({ name: "Clean Code", price: 80, categoryId: cat.id });

const found = await weave.product.findMany(
  { price: { gte: 50 } },
  { expand: { category: true } },
);

found[0].price;          // number | null — `price: int4()` is nullable
found[0].category?.name; // the object, because you expanded it
```

Fields are **nullable by default** — that's why `price` reads as `number | null` and
`category` needs the `?.`. Add `.notNull()` to a field and both become exact:
`price: int4().notNull()` reads back as plain `number`. The types never lie about what
the database allows.

That's the whole loop: objects in, objects out, HTTP and SQL invisible. Next, learn
how to **[design entities](/docs/entities)**.
