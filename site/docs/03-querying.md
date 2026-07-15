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

`opts` is `{ orderBy?, expand?, select?, limit?, latestPer? }` (plus `page` / `perPage`
for `paginate`) — each covered below.

## where — one object language, with a shorthand

A bare value means `eq`:

```ts
{ status: "paid" }          // ≡ { status: { eq: "paid" } }
{ deletedAt: { eq: null } } // IS NULL  (≡ { deletedAt: { isNull: true } })
```

A **null** is the one value the shorthand doesn't take — write `{ eq: null }` or
`{ isNull: true }`. (`{ deletedAt: null }` is a type error: the shorthand carries the
column's own type, and nullability lives in the operator, not in the bare value.)

The same `WhereInput` works in the GUI, in the SDK, and in stored access rules:

```ts
await weave.product.findMany({
  price: { gte: 50, lt: 200 },
  name: { ilike: "%pro%" },
  active: true,
});
```

Scalar operators: `eq` · `ne` · `gt` · `gte` · `lt` · `lte` · `in` · `notIn` ·
`isNull`, plus `like` · `ilike` on string columns.

On an **array column** (`text[]`, `int4[]`, …) the operators are different — `has` ·
`hasSome` · `hasEvery` · `isEmpty` · `some` (any element matches scalar ops):

```ts
{ keywords: { has: "typescript" } }   // contains this element
{ scores: { some: { gte: 5 } } }      // some element is >= 5
```

An operator Weave doesn't know is a **hard error**, never a silent no-match — so a
Prisma/Mongo reflex like `{ name: { contains: "x" } }` tells you to use `ilike` instead
of quietly returning nothing.

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
  tags:  { every: { active: true } },   // quantifiers: some · every · none
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
orders[0].customer;      // ❌ compile error — you didn't expand it
```

That last line is the point: a reference you didn't expand **doesn't exist on the type**,
so you never have to ask at runtime whether a field is an object or a raw id. Expand it
and it's there, typed. Don't, and the compiler stops you.

**owned is part of you, so it comes hydrated; a reference is someone else, so you get
the pointer and `expand` to pull the object.** Expand nests to any depth — the owned
comes for free at every level, references you name.

## How many rows — `findMany`, `limit`, `paginate`

`findMany` returns every matching row up to **10 000** by default — a safety net so you
don't pull a whole table by accident. If more rows matched than you got, it **warns**
(with both numbers): the cut is never silent. Raise or lower it with `limit`; for a paged
UI use `paginate`:

```ts
await weave.product.findMany({ active: true });                // up to 10 000 — warns if more matched
await weave.product.findMany({ active: true }, { limit: 50 }); // at most 50 — your call, no warning
await weave.product.paginate({}, { page: 2, perPage: 100 });   // one page + totals
```

Passing `limit` silences the warning: the ceiling is then your decision, not a default
you didn't know about.

The split: **`findMany`** is "give me the list" (small-to-medium sets, catalogs, seeds);
**`paginate`** is for large sets / paged UI and returns `{ docs, docsQuantity,
pageQuantity, currentPage }`.

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

orders[0].customer;               // present & typed — you expanded it
orders[0].items[0].product.price; // nested, revived (Dates too), inferred
```

No hand-written result types — the shape follows the `expand` you pass. (A nullable
reference still reads as `Target | null`; `.notNull()` on the reference makes it exact.)

## Reading a subset — `select`

By default a read hydrates everything you own. For a deep entity read in a **list**, that
can mean joining tables the screen never shows. Narrow it with `select` — a whitelist
that mirrors the tree; only what you name comes back (`id` always; timestamps only if you
select them):

```ts
await weave.order.findMany(where, {
  select: {
    status: true,
    submittedAt: true,
    customer: true,                    // a whole reference/owned subtree
    items: { sku: true, qty: true },   // just these fields of the owned list
  },
});
```

Anything you don't name — the other columns, the owned subtrees the list doesn't use —
**isn't even joined**. `select` also **subsumes `expand`** (it controls references in the
same key), and the return type follows it. So the detail view reads full (no `select`),
the list reads lean.

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
import storefront from "./weave/scopes/storefront.js";

const tenant = weave.as(storefront, { customerId: ctx.user.id });

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

A `where` is **required** on every by-where verb (`updateOne`/`updateMany`/`deleteOne`/
`deleteMany`) — an empty one is rejected, so you can never mass-mutate by accident. And
under a scope, bulk ops are automatically constrained to that scope's rows.

Two things worth knowing before you reach for them: a bulk op affects at most **100 000**
rows per call, and — unlike `createMany`, which is one transaction — `updateMany` and
`deleteMany` walk the rows one at a time, so a failure midway leaves the earlier ones
applied.

Next: roll rows up — counts, percentiles, breakdowns — with
**[aggregation](/docs/aggregation)**, or lock it down with **[scopes](/docs/scopes)**.
