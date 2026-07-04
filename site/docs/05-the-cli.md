# The CLI

The `weave` CLI moves entities and scopes between your code and the server. The
server is the source of truth; the CLI is how code talks to it.

## Configuration

`WEAVE_URL` and `WEAVE_KEY` come from the environment. A `weave.config.ts` holds
structural choices — chiefly where the generated folder lives (default `weave/`):

```ts
// weave.config.ts
import { defineConfig } from "@mauroandre/weave-sdk";

export default defineConfig({ dir: "weave" });
```

## weave push — code → server

`weave push` sends everything: entities first (the server diffs and applies them),
then scopes, then it re-generates your local files so they pick up any freshly
minted field ids.

```bash
weave push                              # entities + scopes, then re-gen
weave push --confirm product.legacy     # confirm a destructive drop
weave push --fill product.sku="N/A"     # backfill a new required field
weave push --rename product.name=title  # a rename: data preserved, not drop+add
weave push --no-gen                     # apply but don't touch local files (CI)
```

The server classifies every change by risk and gates the dangerous ones:

> 🟢 auto · 🔴 confirm (drops data) · 🟡 needs a value · ⛔ blocked

A rename is otherwise indistinguishable from drop-and-add — `--rename` tells the
server it's the same field (by its stable id), so the data survives.

## weave gen — server → code

`weave gen` mirrors the server's current state back into your `weave/` folder:
readable entity files (each field carrying its stable `$id`), scope files,
re-export barrels, and a ready-to-use client. It's a full overwrite — the server
wins.

```bash
weave gen
```

This is what lets you design in the **dashboard** and pull the result into code, or
hand-write entities and let the server mint their ids. Author wherever you like;
`gen` keeps code and server in sync.

## pushAll — deploying without the CLI

Some deployments have no shell step to run `weave push` — you ship a new container
image and restart, and that's it. For that, the SDK exposes `pushAll`: the same
project push as a plain function you call from your app's boot, before it starts
serving.

```ts
import { pushAll } from "@mauroandre/weave-sdk/cli";

const { applied, review, scopes } = await pushAll({
  url: process.env.WEAVE_URL!,
  key: process.env.WEAVE_KEY!,
  dir: "weave",            // where your entities/ and scopes/ live
});
```

It discovers the entities and scopes in `dir`, orders entities so a referenced one
is applied before the one that references it, sends them to the server, and — only
once the entities converge — pushes the scopes. It returns what was `applied`, the
`review` still waiting on a decision, and the `scopes` pushed.

Unlike `weave push`, `pushAll` **never writes back to your files** (`gen` is a CLI
concern; the container is ephemeral). It is the programmatic equivalent of
`weave push --no-gen` for a whole project.

### Migrate, then serve

The idiom is a short loop at boot: push, and start serving only when nothing is left
to review. A push that hits a destructive change doesn't fail — the server holds
those changes as a **pending migration** and reports them in `review`.

```ts
async function boot() {
  for (;;) {
    const { review } = await pushAll({ url, key });
    if (review.length === 0) break;   // converged — safe to serve
    console.log(`waiting on ${review.length} change(s) — resolve in the dashboard`);
    await sleep(5000);                // hold; a human resolves it in the GUI
  }
  startServer();
}
```

You can also resolve non-interactively — pass `confirm` and `fill` the same way the
CLI flags do, keyed by entity:

```ts
await pushAll({
  url, key,
  confirm: { product: ["legacy"] },      // ok to drop product.legacy
  fill: { product: { sku: "N/A" } },     // backfill the new required product.sku
});
```

### Resolving in the dashboard

When a push can't converge on its own, the held changes surface as a **pending
migration** banner across the dashboard. Opening it shows every waiting change,
grouped by entity, with the same risk markers — 🔴 confirm a drop, 🟡 give a value
for existing rows, ⛔ can't apply here (revert in code). Applying releases the
deploy: the next `pushAll` in the boot loop sees an empty `review` and serves.

Only the **last** `pushAll` matters. The server keeps a single pending slot, so a
newer deploy's push replaces whatever the previous one was waiting on — you always
resolve against the image that's actually trying to come up.
