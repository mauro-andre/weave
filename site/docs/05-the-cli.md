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

The CLI is the interactive, developer-machine path. When there's no shell step —
you just ship a new container image and restart — the same push happens from your
app's boot instead. See **[Deploying](/docs/deploying)**.
