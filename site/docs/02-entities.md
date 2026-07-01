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

### Naming — camelCase in, snake_case in the database

Write field names in **camelCase**, the way you would in TypeScript. Weave stores the
column in **snake_case** — the Postgres convention — automatically:

```ts
firstName   →  column first_name
phoneNumber →  column phone_number
```

You always read and query with the camelCase name (`{ firstName: "Ada" }`); the
snake_case column stays under the hood. Whatever style you type in the GUI (`First
Name`, `first_name`) converges on the same camelCase field.

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

## Composite unique & index

`text().unique()` covers a single column. For a **multi-column** constraint — the kind
a rollup key or a natural key needs — pass a third argument to `defineEntity`:

```ts
import { defineEntity, text, reference } from "@mauroandre/weave-sdk";
import stack from "./stack.js";

export default defineEntity(
  "registryEntry",
  {
    slugName: text().notNull(),
    stack: reference(stack),
    host: text().notNull(),
  },
  {
    unique: [["slugName", "stack"]],   // the pair is unique together
    index:  [["host", "slugName"]],    // a composite (non-unique) index
  },
);
```

Each group lists **field names**: a column maps to its column; a to-one `reference`
maps to its foreign key (`stack` → `stack_id`). Adding a `unique` group to an entity
that already has duplicate rows is a **blocked** change — resolve the duplicates first
(the same review gate as any migration).

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
