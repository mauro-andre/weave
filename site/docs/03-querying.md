# Querying

Every entity on the client exposes the same methods:

```ts
weave.product.create(data);
weave.product.get(id);
weave.product.find({ where, orderBy, expand });
weave.product.findOne({ where, expand });
weave.product.paginate({ where, page, perPage });
weave.product.update(id, data);
weave.product.delete(id);
```

## where — one object language

Filters are plain objects. The same `WhereInput` works in the GUI, in the SDK, and
in stored access rules.

```ts
await weave.product.find({
  where: {
    price: { gte: 50, lt: 200 },
    name: { ilike: "%pro%" },
    active: { eq: true },
  },
});
```

Scalar operators: `eq` · `ne` · `gt` · `gte` · `lt` · `lte` · `in` · `notIn` ·
`isNull` · `like` · `ilike`.

### Boolean composition

```ts
where: {
  or: [{ status: { eq: "paid" } }, { total: { gte: 1000 } }],
  not: { archived: { eq: true } },
}
```

### Through references and owned lists

Traverse a reference by nesting; filter a list with a quantifier:

```ts
where: {
  category: { name: { eq: "Books" } },          // N:1 traversal
  items: { some: { qty: { gte: 3 } } },          // any item matches
  tags:  { every: { active: { eq: true } } },    // all match · none · isEmpty
}
```

## orderBy

```ts
orderBy: { price: "desc" }
orderBy: { customer: { name: "asc" } }   // sort by a nested field
```

## expand — read the graph

By default a query returns the entity's own columns. Ask for related data with
`expand`, and **the return type follows your request**:

```ts
const orders = await weave.order.find({
  expand: { customer: true, items: { product: true } },
});

orders[0].customer.name;          // present & typed — you expanded it
orders[0].items[0].product.price; // nested, revived (Dates too), inferred
```

No hand-written result types: `find` infers its shape from the `expand` you pass.

Next: lock it down with **[scopes](/docs/scopes)**.
