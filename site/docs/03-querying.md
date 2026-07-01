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
