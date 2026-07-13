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
- **where** — the same `WhereInput` you query with. It filters which rows are **visible**
  (read / update-target / delete-target) **and** what a write may **produce**: a `create`
  or `update` whose resulting row would fall outside the filter is rejected (`403`). So a
  scope can never be used to write into — or move a row into — another tenant.
- **fields** — `include` or `exclude` a set of paths (dot-paths into owned/refs).

## Parameters

A rule can depend on request-time values with `{ param: "name" }` — perfect for
per-tenant or per-user filtering. The `where` is fully typed against the entity, and
literal and `{ param }` values mix freely in the same tree:

```ts
scopeRule(order, {
  verbs: ["read"],
  where: { and: [
    { customer: { id: { eq: { param: "customerId" } } } }, // a request-time param
    { status: { ne: "draft" } },                            // a literal
  ]},
});
```

The param **names are inferred** from the rules — you never declare them. `defineScope`
carries them into its type, so `weave.as` **requires the params object, typed**: a missing
or misspelled param is a compile error, not a runtime surprise.

```ts
weave.as(storefront, { customerId: ctx.user.id }); // ✓
weave.as(storefront, {});                           // ✗ — 'customerId' is required
```

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

## Scoped per request — `scopedWeave`

`weave.as(scope, params)` returns a scoped client you thread by hand. In a multi-tenant
server that means passing it through every service call — and forgetting once leaks god
access. The **scoped** client removes the threading: it resolves the active scope from an
`AsyncLocalStorage` context, so your services just use `scopedWeave.*` and get the right
scoped client automatically.

When your project has scopes, `weave gen` exports it for you — no config — alongside the
plain god client, sharing one connection:

```ts
// weave/index.ts (generated)
export const weave = createClient({ ... });               // god — boot, ETL, scripts
export const scopedWeave = createScopedClient(weave);     // request-scoped, fail-closed
```

```ts
import { weave, scopedWeave } from "./weave/index.js";

// auth runs BEFORE a scope exists → the plain god client:
const user = await weave.session.findOne({ token });

// middleware — establish the scope for the whole request, from the user's role:
app.use((ctx, next) =>
  scopedWeave.runAs(scopeFor(ctx.user.role), { companyId: ctx.user.companyId }, () => next()),
);

// any service / loader inside the request — zero plumbing, already scoped:
const orders = await scopedWeave.order.findMany();
```

**Fail-closed by construction.** Outside any `runAs`, `scopedWeave.*` **throws**
(`WeaveScopeError`) — never god. Forgetting the middleware, or losing the async context,
**denies** the request; it never silently falls back to full access. That's the opposite of
the usual "default to admin" footgun — a missing scope fails loud, not open. (The plain
`weave` is always god; that's why boot and pre-scope auth use it, not `scopedWeave`.)

The ways to run:

```ts
scopedWeave.runAs(scope, params, fn) // scoped for fn (sync or async); params typed & required
scopedWeave.runAs(publicScope, fn)   // a scope with no params → no params object needed
scopedWeave.runAsGod(fn)             // explicit full access for fn (a trusted admin route, or
                                     // a deliberate cross-tenant op inside a scoped request)
scopedWeave.god                      // the shared god client (=== weave) — reach it from anywhere
```

`runAs` returns whatever `fn` returns, and the scope **propagates across every `await`**
inside it. Runs **nest**: a `runAsGod` inside a `runAs` shadows the scope for its callback,
and the outer scope restores when it returns.

`createScopedClient` lives in the main `@mauroandre/weave-sdk` (it uses Node's
`AsyncLocalStorage`, like the rest of the server-side SDK). The explicit
`weave.as(scope, params)` stays available for one-off scoped calls.
