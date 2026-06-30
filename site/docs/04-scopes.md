# Scopes

A **scope** is a named access policy. Per entity it decides three things: which
**verbs** are allowed, which **rows** are visible, and which **fields** are exposed.
You write it by name; the server stores it by stable field-id (so it survives
renames) and enforces it on every request.

```ts
// weave/scopes/storefront.ts
import { defineScope } from "@mauroandre/weave-sdk";

export default defineScope("storefront", {
  product: {
    verbs: ["read"],
    where: { active: { eq: true } },
    fields: { exclude: ["cost"] },
  },
  order: {
    verbs: ["read", "create"],
    where: { customer: { id: { eq: { param: "customerId" } } } },
  },
});
```

- **verbs** — any of `read` · `create` · `update` · `delete`.
- **where** — the same `WhereInput` you query with; rows outside it don't exist for
  this scope.
- **fields** — `include` or `exclude` a set of paths (dot-paths into owned/refs).

## Parameters

A rule can depend on request-time values with `{ param: "name" }` — perfect for
per-tenant or per-user filtering.

## Acting under a scope

The god-mode key is for trusted server-side use. To serve a request as a tenant,
derive a scoped client:

```ts
const tenant = weave.as("storefront", { customerId: ctx.user.id });

await tenant.product.find();  // only active products, no `cost` field
await tenant.order.create(o); // allowed; rows still constrained to this customer
```

The server enforces the scope's verbs, rows and fields — the client can't widen
them. Push scopes to the server with **[the CLI](/docs/the-cli)**.
