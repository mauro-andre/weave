# Scopes

A **scope** is a named access policy. Per entity it decides three things: which
**verbs** are allowed, which **rows** are visible, and which **fields** are exposed.
You write it by name; the server stores it by stable field-id (so it survives
renames) and enforces it on every request.

```ts
// weave/scopes/storefront.ts
import { defineScope, scopeRule } from "@mauroandre/weave-sdk";
import product from "../entities/product.js";
import order from "../entities/order.js";

export default defineScope("storefront", [
  scopeRule(product, {
    verbs: ["read"],
    where: { active: { eq: true } },
    fields: { exclude: ["cost"] },
  }),
  scopeRule(order, {
    verbs: ["read", "create"],
    where: { customer: { id: { eq: { param: "customerId" } } } },
  }),
]);
```

Each rule is bound to its entity **by reference** with `scopeRule(entity, …)` — the same
entity object you `defineEntity`'d, exactly like `reference(entity)`. No entity name is
ever a loose string, so a typo or a rename can't silently produce a broken (over-permissive)
policy.

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
import storefront from "./weave/scopes/storefront.js";

const tenant = weave.as(storefront, { customerId: ctx.user.id });

await tenant.product.findMany();  // only active products, no `cost` field
await tenant.order.create(o);     // allowed; rows still constrained to this customer
```

`weave.as` takes the **scope object** (`defineScope(…)`) — recommended — or its name as a
string. Passing the object keeps a single source of truth, just like importing an entity.

The verbs stay the same — `findOne` · `findMany` · `paginate` · `create` · … — you
just call them on the scoped client. The API doesn't change under a scope; the server
enforces the scope's verbs, rows and fields, and the client can't widen them. Push
scopes to the server with **[the CLI](/docs/the-cli)**.
