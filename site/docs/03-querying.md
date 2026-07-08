# Querying

Every entity exposes the same object verbs. You target rows with a bare **where** —
and `{ id: "123" }` is just shorthand for `{ id: { eq: "123" } }`.

```ts
weave.product.create(input)                // insert one
weave.product.createMany(inputs)           // insert many in one transaction

weave.product.findOne(where, opts?)        // first match  → object | null
weave.product.findMany(where?, opts?)      // all matches  → object[]
weave.product.paginate(where?, opts?)      // { docs, docsQuantity, ... }

weave.product.updateOne(where, patch)      // first match, updated  → object | null
weave.product.updateMany(where, patch)     // bulk  → { count }

weave.product.deleteOne(where)             // first match, deleted  → object | null
weave.product.deleteMany(where)            // bulk  → { count }
```

The rule is uniform: **`One`** targets the first match (`orderBy` disambiguates) and
returns the object; **`Many`** operates in bulk and returns `{ count }`. To act by id,
just filter on it — `findOne({ id })`, `updateOne({ id }, patch)`, `deleteOne({ id })`.

`opts` is `{ orderBy?, expand? }` (plus `page` / `perPage` for `paginate`).

## where — one object language, with a shorthand

A bare value means `eq`, and `null` means `IS NULL`:

```ts
{ status: "paid" }    // ≡ { status: { eq: "paid" } }
{ deletedAt: null }   // ≡ { deletedAt: { isNull: true } }
```

The same `WhereInput` works in the GUI, in the SDK, and in stored access rules:

```ts
await weave.product.findMany({
  price: { gte: 50, lt: 200 },
  name: { ilike: "%pro%" },
  active: true,
});
```

Scalar operators: `eq` · `ne` · `gt` · `gte` · `lt` · `lte` · `in` · `notIn` ·
`isNull` · `like` · `ilike`.

### Boolean composition

```ts
{
  or: [{ status: "paid" }, { total: { gte: 1000 } }],
  not: { archived: true },
}
```

### Through references and owned lists

```ts
{
  category: { name: "Books" },          // N:1 traversal
  items: { some: { qty: { gte: 3 } } }, // any item matches
  tags:  { every: { active: true } },   // all match · none · isEmpty
}
```

## What comes back by default

A read hydrates what you **own** and hands you a pointer to what you **reference** —
the split follows composition, not a flag you set.

| Field | In a plain read? | To populate |
|---|---|---|
| Scalar columns | ✅ yes | — |
| `owned` object / list | ✅ **yes — fully nested** | automatic |
| `reference` (N:1) | just the `…Id` (e.g. `categoryId`) | `expand: { category: true }` |
| `reference` (N:N) | nothing | `expand: { tags: true }` |
| `id` · `createdAt` · `updatedAt` | ✅ yes | — |

```ts
const orders = await weave.order.findMany();

orders[0].items;         // owned list — already here, nested
orders[0].customerId;    // N:1 reference — the pointer is here
orders[0].customer;      // undefined — you didn't expand it
```

**owned is part of you, so it comes hydrated; a reference is someone else, so you get
the pointer and `expand` to pull the object.** Expand nests to any depth — the owned
comes for free at every level, references you name.

## orderBy & expand — the opts

```ts
await weave.product.findMany(
  { price: { gte: 50 } },
  { orderBy: { price: "desc" }, expand: { category: true } },
);
```

`expand` reads the graph, and **the return type follows it**:

```ts
const orders = await weave.order.findMany(
  {},
  { expand: { customer: true, items: { product: true } } },
);

orders[0].customer.name;          // present & typed — you expanded it
orders[0].items[0].product.price; // nested, revived (Dates too), inferred
```

No hand-written result types — the shape follows the `expand` you pass.

## Naming types at the boundary

Inside a query you never name a type. But when you wrap the client in your own service
helpers, name the query types with the `Infer*` aliases — no `as never`, no `Parameters<>`:

```ts
import type { InferWhere, InferPatch } from "@mauroandre/weave-sdk";
import user from "./weave/entities/user.js";

const getUser    = (where: InferWhere<typeof user>) => weave.user.findOne(where);
const updateUser = (where: InferWhere<typeof user>, patch: InferPatch<typeof user>) =>
  weave.user.updateOne(where, patch);

// verify an email in one call — find by token, set verified, clear the code:
await updateUser({ emailVerifyCode: token }, { emailVerified: true, emailVerifyCode: null });
```

The family: `Infer` (read object) · `InferInsert` (create) · `InferPatch` (update) ·
`InferWhere` · `InferOrderBy`. The raw `WhereInput` / `OrderByInput` are exported too.

## Querying under a scope

Every verb above also runs under a **scope** — a named access policy. Derive a scoped
client with `.as(scope, params?)` and call the *same* methods:

```ts
const tenant = weave.as("storefront", { customerId: ctx.user.id });

await tenant.product.findMany({ price: { gte: 50 } }); // only rows the scope allows
await tenant.product.findOne({ id });                  // same shape, one row
await tenant.order.paginate({}, { page: 1 });          // rows already constrained
```

The find API is identical — the scoped client just sends the scope with every request,
and the **server** narrows which rows, fields and verbs come back. Your `where` is
intersected with the scope's, never widened. Define the policies in
**[scopes](/docs/scopes)**.

## Bulk updates and deletes

```ts
await weave.todo.updateMany({ done: false }, { archived: true }); // → { count }
await weave.todo.deleteMany({ archived: true });                  // → { count }
```

A `where` is **required** — an empty one is rejected, so you can never mass-mutate by
accident. And under a scope, bulk ops are automatically constrained to that scope's
rows.

Next: roll rows up — counts, percentiles, breakdowns — with
**[aggregation](/docs/aggregation)**, or lock it down with **[scopes](/docs/scopes)**.
