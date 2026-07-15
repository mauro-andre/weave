# Weave — Agent Rules

You are building an application **with** Weave. This file is the constitution and the
map. It is not documentation: load the matching skill (below) before writing anything
non-trivial.

## Weave is two things, and your app is neither

```
your app ──HTTP──▶ Weave server ──SQL──▶ Postgres
 (weave-sdk)       (container)          (Weave owns this)
```

A **server** (container: `ghcr.io/mauro-andre/weave`, listening on `3000`) and a **client**
(npm: `@mauroandre/weave-sdk`). Your app installs the SDK and talks to the server over
HTTP; the **server** holds the Postgres connection and is the only thing that speaks SQL.

Your app **never connects to Postgres** and **never runs a migration**. There is no
embedded mode. `@mauroandre/weave` and `@mauroandre/weave-core` are not on npm — every
symbol you import comes from `@mauroandre/weave-sdk`.

You will usually run the server yourself (compose, next to your app). Its environment:

| Var | |
|---|---|
| `DATABASE_URL` | the Postgres it manages. **Required** — no default |
| `SESSION_SECRET` | signs the dashboard session. **Required** — no default, and the server refuses to start without it |
| `MASTER_USERNAME` / `MASTER_PASSWORD` | dashboard login; also re-seeded after a reset |
| `WEAVE_API_KEY` | optional god key straight from the env — survives a `reset()`, so it's what test suites authenticate with |
| `WEAVE_DEV_MODE` | truthy enables `weave.reset()`; unset → `403`. Never set in production |
| `WEAVE_ID_TYPE` | `uuid` (default) or `objectId` for a MongoDB migration. **Set-once** — not switchable with data in the database |
| `PLATFORM_DATABASE_URL` | overrides `DATABASE_URL` when set — takes precedence |

Your app's own env is only `WEAVE_URL` and `WEAVE_KEY`.

You think in **objects**, never in SQL. Never introduce, suggest, or import Prisma,
TypeORM, Drizzle, Mongoose, Knex, or a raw `pg`/`postgres` client. There is no raw-SQL
escape hatch in the SDK, by design. If a task seems to need one, you have misread the
task — load the relevant skill first.

## The verb map — what your reflexes map to

| Your reflex | Weave |
|---|---|
| `findMany({ where })` | `findMany(where, opts?)` — **where is the 1st positional arg**, never a key |
| `findFirst` / `findUnique` | `findOne(where, opts?)` — first match; `orderBy` breaks ties |
| `include` / `populate` / `$lookup` | `opts.expand` — `{ expand: { author: true } }` |
| `select` | `opts.select` — Prisma's `select` **and** `include` merged (it also drives references) |
| `aggregate([pipeline])` | `aggregate(input)` — one object, never a pipeline array |
| `groupBy(...)` (method) | `aggregate({ groupBy, select })` |
| `count()` (method) | `aggregate({ select: { n: count() } })`, or `paginate(...).docsQuantity` |
| `distinct` (value list) | `groupBy`. The `distinct()` accumulator is `count(distinct …)` — a **number** |
| `join` | never. `owned` auto-nests; `expand` for references; dot-paths in `aggregate` |
| raw SQL | **does not exist** — no escape hatch |
| `transaction` / `session` | **does not exist**. `createMany` **is** one transaction; `updateMany`/`deleteMany` are **not** |
| migration files | `weave push` (diff-based), or `pushAll` at boot |
| `schema.prisma` / `model` | `defineEntity(name, columns, options?)` in TypeScript |
| `save` | `create` / `updateOne` / `updateMany`. Update is a **merge** — omitted fields are preserved |
| `upsert` | `create` with an explicit `id`; for counters → `accumulate(key, ops)` |
| `connect` / `disconnect` | set the FK: `<field>Id` (N:1) or `<field>Ids` (N:N) — **see the table below** |
| `take` / `skip` / `offset` | `{ limit }` (page 1), or `paginate({ page, perPage })` |
| `.lean()` | unnecessary — reads are already plain objects |

Nearly every other reflex is a **compile error**, which is the point: the types are the
guard rail. `{ deletedAt: null }`, `include`, `take`, `.findFirst()`, `.upsert()`,
`contains` in a typed `where` — all rejected by `tsc`. Trust it, and fix what it flags.

## Rules that fail silently

These do not fail typecheck. They do not throw. They produce a working app that is
wrong. Every row below was verified by executing it — treat them as hard constraints.

| Never write | Always write | What silently happens |
|---|---|---|
| `updateOne(where, { tagsIds: [newId] })` to add a link | read the set, then write it whole: `{ tagsIds: [...old, newId] }` | `<field>Ids` **replaces** the N:N set — the links you left out are **deleted**. `["a","b"]` + `["c"]` → `["c"]` |
| hand-written code in `weave/entities/` or `weave/scopes/` | any other directory — e.g. `app/access.ts` for a dispatch table | `weave gen` **and** `weave push` `rm -rf` both directories and rebuild them from the server. Your file is gone; exit code is still `0` |
| `price: int4()` when the field is required | `price: int4().notNull()` | columns and references are **nullable by default** — the inverse of Prisma. `create({})` without the field succeeds and stores `null` |
| relying on a scope's `where` to protect an entity you reach via `expand` | put the row filter on the entity you **query**, not only on the one you expand | verbs and field projections compose across a reference; **row filters do not**. The expanded object is fetched without the target's `where` |

## Scope security

**The API key is god.** A request with no `x-weave-scope` header gets everything. A scope
is a restriction the key-holder opts into — not a wall that stops it. So:

- The key is a **server-side secret**. If it reaches a browser, every scope is bypassable
  by simply not sending the header. Never import the Weave client into client-side code.
- **Scope params must come from the authenticated principal** — a verified session or
  token. Never from a query string, body, or URL segment. `weave.as(scope, { companyId:
  ctx.user.companyId })` is right; taking `companyId` from the request is an IDOR.
- Client input may be a **`where` filter**, never a scope param. The scope's own filter is
  ANDed server-side, so a forged filter narrows — it cannot widen.

**Deny beats projecting.** To hide an entity from a scope, give it no rule at all rather
than `read` with a narrow `fields`. A denied entity fails loudly (403) if some future
`expand` reaches it; a projected one quietly grants read to every row.

`runAsGod` on a request path is a hole by construction. Each one needs a reason.

## The map

| Path | Role |
|---|---|
| `weave/entities/*.ts` | **Generated.** One entity per file, default export. Never hand-edit — `gen` rebuilds it |
| `weave/scopes/*.ts` | **Generated.** `defineScope(name, [scopeRule(entity, …)])` |
| `weave/index.ts` | **Generated.** Exports `weave` (god) and, when scopes exist, `scopedWeave` |
| `weave.config.ts` | Optional; only `dir` (default `"weave"`) |
| your own code | entity/scope authoring before the first push, dispatch tables, services |

The client is **server-only** — it carries the API key. Convention in this codebase (not
enforced by Weave): data access lives in `app/modules/<domain>/*.service.ts`, and callers
never touch the client directly.

## Load the skill first

Before writing anything non-trivial, load the skill for the subject. Do not infer the API
from this file — it is deliberately incomplete.

| Subject | Skill |
|---|---|
| First project, connecting an app, API key | `getting-started` |
| Modeling: fields, owned vs reference, mirror, self/circular refs, unique/index | `entities` |
| Reading and writing: where, expand, select, orderBy, pagination, `Infer*` types | `querying` |
| Tenants, roles, permissions, row/field isolation, `runAs`, dispatcher | `scopes` |
| `weave push`, `weave gen`, migrations, `weave.config.ts` | `the-cli` |
| Metrics, charts, counters, groupBy, accumulators, `accumulate` | `aggregation` |
| Test suites, `weave.reset()`, dev/CI database | `testing` |
| Deploy, boot-time `pushAll`, env vars, MongoDB migration | `deploying` |
