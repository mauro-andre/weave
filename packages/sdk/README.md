# @mauroandre/weave-sdk

Typed object client for [Weave](https://github.com/mauro-andre/weave) — a code-first
object abstraction over PostgreSQL. You think in nested objects; the SDK speaks HTTP
to the Weave server for you. **No SQL, no REST plumbing, no hand-written result types.**

The Weave server itself runs as a container (`ghcr.io/mauro-andre/weave`) — it holds
your entities, data, and access rules. This package is what your application installs
to talk to it.

```bash
npm install @mauroandre/weave-sdk
```

## Quick start

```ts
import { createClient } from "@mauroandre/weave-sdk";
import { product, category } from "./weave/entities";

const weave = createClient({
  url: process.env.WEAVE_URL!,
  key: process.env.WEAVE_KEY!,
  entities: { product, category },
});

const cat = await weave.category.create({ name: "Books" });
const p = await weave.product.create({ name: "Clean Code", price: 80, categoryId: cat.id });

const found = await weave.product.findMany(
  { price: { gte: 50 }, category: { name: { ilike: "%book%" } } },
  { orderBy: { price: "desc" }, expand: { category: true } },
);

found[0].price;          // number  — inferred
found[0].createdAt;      // Date    — revived from JSON
found[0].category.name;  // string  — typed & present, only because you expanded it
```

The verbs per entity: `create` · `createMany` · `findOne` · `findMany` · `paginate` ·
`updateOne` · `updateMany` · `deleteOne` · `deleteMany` · `aggregate`. You target rows
with a bare **where** (`{ id: "123" }` is shorthand for `{ id: { eq: "123" } }`); `One`
hits the first match, `Many` operates in bulk and returns `{ count }`. The read return
type **self-types by your `expand`**, so you never write a result type by hand.

## One query language

`where` / `orderBy` / `expand` are the same object language everywhere — the GUI
click, the SDK call, and the stored access rule all speak it. A taste:

```ts
await weave.order.findMany(
  {
    or: [{ status: "paid" }, { total: { gte: 1000 } }],
    items: { some: { product: { name: { ilike: "%pro%" } } } }, // any item matches
  },
  { orderBy: { customer: { name: "asc" } } },                    // nested sort
);
```

## Aggregation

Roll rows into numbers — counts, sums, percentiles, breakdowns — in one call, pushed
down to Postgres. Accumulators (`count`/`sum`/`avg`/`min`/`max`/`distinct`/`percentile`/
`histogram`) go in `select`; `groupBy`, `having`, `orderBy` and `page` behave like SQL
without the SQL:

```ts
import { count, percentile, timeBucket } from "@mauroandre/weave-sdk";

const series = await weave.appRequest.aggregate({
  where: { host: "api", ts: { gte: since } },
  groupBy: { ts: timeBucket("ts", "5min") },
  select: { requests: count(), p95: percentile("durationMs", 0.95) },
  orderBy: { ts: "asc" },
});
```

Every accumulator takes an optional `{ where }` (→ a filtered aggregate), expressions
(`div`/`mul`/`add`/`sub`) let you sort/filter by a derived rate server-side, and
`facets` runs many breakdowns of the same set in one pass. Batch ingest is
`createMany([...])` (one transaction); `findMany(where, { latestPer, orderBy })` gives
you the latest row per group. Full tour: **[weavepg.dev/docs/aggregation](https://weavepg.dev/docs/aggregation)**.

## Entities as code

Declare entities with the same builders the server uses — one file, one entity:

```ts
// weave/entities/product.ts
import { defineEntity, text, int4, reference } from "@mauroandre/weave-sdk";
import category from "./category.js";

export default defineEntity("product", {
  name: text().notNull(),
  price: int4(),
  category: reference(category),
});
```

A third argument declares **composite** unique constraints and indexes — each group is
a list of field names (a `reference` maps to its foreign key):

```ts
export default defineEntity(
  "registryEntry",
  { slugName: text().notNull(), stack: reference(stack), host: text() },
  { unique: [["slugName", "stack"]], index: [["host", "slugName"]] },
);
```

## The CLI — code ↔ server

`url`/`key` come from the environment (`WEAVE_URL`, `WEAVE_KEY`). A `weave.config.ts`
holds structural decisions — where the generated folder lives (default `weave/`):

```ts
import { defineConfig } from "@mauroandre/weave-sdk";
export default defineConfig({ dir: "weave" });
```

```bash
weave push                              # entities (plan → apply) + scopes, then re-gen locally
weave push --confirm product.legacy     # confirm a destructive drop
weave push --fill product.sku="N/A"     # backfill a new required field
weave push --rename product.name=title  # a rename: data preserved, not drop+add
weave push --no-gen                     # apply to the server but don't touch local files (CI)
weave gen                               # regenerate the whole weave/ folder from the server
```

The server is the source of truth. `weave push` sends your code to it (the server
diffs and applies, with risk buckets: 🟢 auto · 🔴 confirm · 🟡 needs value · ⛔
blocked). `weave gen` mirrors the server back into readable `.ts` — entity files
(each field carrying its stable `$id`), scope files, barrels, and a ready `weave`
client. You can author in the GUI **or** in code, mixed.

## Access control as code

A scope shapes access per entity — which **verbs**, which **rows**, which **fields**.
You write it by name; the server stores it by stable field-id (rename-proof).

```ts
// weave/scopes/storefront.ts
import { defineScope } from "@mauroandre/weave-sdk";

export default defineScope("storefront", {
  product: { verbs: ["read"], where: { active: { eq: true } }, fields: { exclude: ["cost"] } },
});
```

Act under a scope at request time:

```ts
const tenant = weave.as("storefront", { tenantId: ctx.tenant });
await tenant.product.findMany(); // server enforces the scope's rows + fields
```

## License

MIT © Mauro André
