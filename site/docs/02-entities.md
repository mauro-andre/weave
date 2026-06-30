# Entities

An **entity** is a kind of object you store — `product`, `order`, `customer`. You
design it once; Weave maps it to Postgres and exposes it as objects everywhere. One
file, one entity, a default export:

```ts
// weave/entities/product.ts
import { defineEntity, text, int4, bool } from "@mauroandre/weave-sdk";

export default defineEntity("product", {
  name: text().notNull(),
  price: int4(),
  active: bool().default(true),
});
```

## Fields

Fields are built from catalog types and chained modifiers:

```ts
text()            // a string column
int4()            // a 32-bit integer
text().notNull()  // required
text().unique()   // unique constraint
text().index()    // indexed
int4().default(0) // default value
```

Common types: `text` · `int4` · `int8` · `float8` · `numeric` · `bool` ·
`timestamptz` · `uuid` · `jsonb`. Every entity gets `id`, `createdAt` and
`updatedAt` for free.

## Owned objects — composition

An **owned** object lives inside its parent (its own child table, cascade-deleted
with the parent). Use it for parts that have no life of their own:

```ts
import { defineEntity, text, int4, owned, array } from "@mauroandre/weave-sdk";

export default defineEntity("order", {
  ref: text().notNull().unique(),
  // a single owned object (1:1)
  shipping: owned({ address: text().notNull(), city: text().notNull() }),
  // a list of owned objects (1:N)
  items: owned(array({ sku: text().notNull(), qty: int4().notNull() })),
});
```

## References — association

A **reference** points at another independent entity — shared, never owned:

```ts
import { defineEntity, reference, array } from "@mauroandre/weave-sdk";
import category from "./category.js";
import tag from "./tag.js";

export default defineEntity("product", {
  // N:1 — reads `categoryId`, and `category` when expanded
  category: reference(category),
  // N:N — writes via `tagsIds`, reads `tags` when expanded
  tags: reference(array(tag)),
});
```

The difference in one line: **owned** is part of you and cascades; a **reference**
is someone else you point at.

## Scalar arrays

Wrap a column in `array()` for a `text[]` / `int4[]` column:

```ts
import { defineEntity, text, array } from "@mauroandre/weave-sdk";

export default defineEntity("article", {
  title: text().notNull(),
  keywords: array(text()), // text[] — defaults to []
});
```

Once your entities exist, learn to **[query them](/docs/querying)**, or push them
to the server with **[the CLI](/docs/the-cli)**.
