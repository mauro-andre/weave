---
description: "Going to production: pushAll at boot (the migrate-then-serve loop), resolving gated migrations from the pipeline or the dashboard, the server's env vars, and WEAVE_ID_TYPE for migrating an app off MongoDB. Use when deploying, wiring boot-time schema sync, or moving from MongoDB."
---
# Deploying

In production there's often no shell step to run `weave push` — you build a new
container image, swap it in, and restart. The schema change has to happen as the
app comes up: **migrate, then serve**. That's what `pushAll` is for.

`pushAll` is the project-level push as a plain function you call from your app's boot
before it starts serving. It lives in the main SDK entry, next to `pushEntities` and
`pushScopes`.

## pushAll — push from your boot

You already `import` your entities and scopes to build the app — hand those objects
straight to `pushAll`. There's no file discovery, so it runs identically in dev
(`.ts` sources) and in a built image (`.js`).

```ts
import { pushAll } from "@mauroandre/weave-sdk";
import * as entities from "./weave/entities/index.js"; // Record<string, Entity>
import * as scopes from "./weave/scopes/index.js";     // {} when there are none

const { applied, review, scopes: pushed } = await pushAll({
  url: process.env.WEAVE_URL!,
  key: process.env.WEAVE_KEY!,
  entities,
  scopes,        // optional — omit (or pass {}) if the project has no scopes
});
```

It orders entities so a referenced one is applied before the one that references
it, sends them to the server, and — only once the entities converge — pushes the
scopes. It returns what was `applied`, the `review` still waiting on a decision,
and the `scopes` pushed.

A push is one atomic unit of intent: the whole project — entities and scopes — as
the deploy wants it. Unlike `weave push`, `pushAll` **never writes back to your
files** (`gen` is a CLI concern; the container is ephemeral).

Two differences from the CLI worth knowing. `pushAll` registers a **pending migration**
the dashboard can resolve (see below) — `weave push --no-gen` does not, so the two are
not equivalent despite the similar intent. And there is no `renames` option: a field
rename at boot degrades to drop-and-add and blocks the deploy on a 🔴 gate, so do renames
from a terminal with `weave push --rename` before shipping the image.

## Migrate, then serve

The idiom is a short loop at boot: push, and start serving only when nothing is
left to review. A push that hits a destructive change doesn't fail — the server
holds those changes as a **pending migration** and reports them in `review`.

```ts
async function boot() {
  for (;;) {
    const { review } = await pushAll({ url, key, entities, scopes, source: "boot" });
    if (review.length === 0) break;   // converged — safe to serve
    console.log(`waiting on ${review.length} change(s) — resolve in the dashboard`);
    await sleep(5000);                // hold; a human resolves it in the GUI
  }
  startServer();
}
```

The new image never serves a half-applied schema: it either converges and starts,
or it waits — visibly — for a human to resolve the risky part.

## Resolving without a human

If the deploy pipeline already knows the answer, resolve it non-interactively —
pass `confirm` and `fill` the same way the CLI flags do, keyed by entity. The push
then converges on the first try.

```ts
await pushAll({
  url, key, entities, scopes,
  confirm: { product: ["legacy"] },      // ok to drop product.legacy
  fill: { product: { sku: "N/A" } },     // backfill the new required product.sku
});
```

## Resolving in the dashboard

When a push can't converge on its own and no answer was supplied, the held changes
surface as a **pending migration** banner across the dashboard. Opening it shows
every waiting change, grouped by entity, with the same risk markers — 🔴 confirm a
drop, 🟡 give a value for existing rows, ⛔ can't apply here (revert in code).
Applying releases the deploy: the next `pushAll` in the boot loop sees an empty
`review` and serves.

Only the **last** `pushAll` matters. The server keeps a single pending slot, so a
newer deploy's push replaces whatever the previous one was waiting on — you always
resolve against the image that's actually trying to come up.

## The server's environment

Your app needs `WEAVE_URL` and `WEAVE_KEY`. The **server** reads these:

| Var | |
|---|---|
| `DATABASE_URL` | the Postgres it manages. **Required** — the server won't start without it |
| `SESSION_SECRET` | signs the dashboard session. **Required, no default** — it used to fall back to a literal, which meant anyone could forge a session; now the server refuses to start instead. Use a long random string (`openssl rand -hex 32`) |
| `MASTER_USERNAME` / `MASTER_PASSWORD` | the dashboard login. Also what re-seeds the master user after a `reset()` — leave them set, or a reset locks you out of the dashboard |
| `WEAVE_API_KEY` | optional fixed god key straight from the environment. It survives a `reset()` (dashboard keys don't), which is why test suites use it |
| `WEAVE_DEV_MODE` | truthy enables `weave.reset()`. **Never set in production** |
| `WEAVE_ID_TYPE` | `uuid` (default) or `objectId` — see below. Set-once |
| `PORT` | defaults to `3000` |
| `PLATFORM_DATABASE_URL` | **overrides `DATABASE_URL` when set.** Only useful if you're pointing the control plane somewhere else; if a deploy reads the wrong database, look here first |

## Migrating from MongoDB — `WEAVE_ID_TYPE`

Weave ids are UUID v7 by default. Migrating a MongoDB app, every id is a 24-hex
**ObjectId** string, and your data (and every front-end link) references those strings —
so brand-new UUIDs would break every link at cutover.

Set **`WEAVE_ID_TYPE=objectId`** on the server and Weave keeps the ObjectId shape end to
end: the `id` and all foreign-key columns become `char(24)`, and new rows get an
ObjectId-compatible id (byte-exact Mongo layout — timestamp + random + counter, unique
and time-ordered, no `bson` dependency).

The cutover:

```bash
WEAVE_ID_TYPE=objectId   # on the Weave server
```

1. Boot with the env set, then push your schema — tables are created with `char(24)` ids.
2. Bulk-insert your Mongo documents **with their original ids** (Weave honours a supplied
   `id`) — every foreign key still matches, so the links hold.
3. New rows written after the cutover get a generated ObjectId.

`WEAVE_ID_TYPE` is a **fixed instance property** — it describes your entities' id scheme
and must be chosen before the database has data (it can't switch on a live database).
Default is `uuid`; leave it unset for a normal deployment.
