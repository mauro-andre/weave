# Testing

Weave gives your test suite a **factory reset** — the equivalent of "drop every
collection" you'd do against a scratch database, but total: it wipes the data, the
entity tables (owned, join and partitions included), and the schema definitions
themselves. A `weave push` right after rebuilds everything from your
entities-as-code, so each run starts from an identical, known state.

The shape of a suite's global setup, once per run:

```
reset  →  push (rebuild schema)  →  seed
```

## Factory reset — `weave.reset()`

```ts
await weave.reset(); // wipes the database back to a virgin Postgres
```

After it, the database is empty — no entities, no data, no app tables; only the empty
`weave_*` metastore the server rebuilds for itself. Follow it with a push to recreate the
schema, then seed through your normal routes.

This is **destructive and dev/test only** — see the guard below.

## The guard — `WEAVE_DEV_MODE`

The reset is gated by a server environment variable, `WEAVE_DEV_MODE`:

- **Set to a truthy value** (`true`, `1`, `yes`, `on`) → reset is allowed.
- **Unset, or set to anything else** (`false`, `0`, …) → the endpoint responds `403` and
  **does nothing**. The gate reads the value, not the presence.

Production simply never sets it; your dev/CI compose does. The API key is still
required as usual, but the decision *"may this reset run at all?"* is 100% the
environment — a stray key can never wipe a production database.

```yaml
# docker-compose for dev/test only
environment:
  WEAVE_DEV_MODE: "true"
```

## The key that survives the wipe — `WEAVE_API_KEY`

A reset erases the API keys you created in the dashboard along with everything else.
So the key your suite authenticates with must be the **environment god-key**,
`WEAVE_API_KEY` — the server accepts it straight from the environment, without a
database lookup, so it keeps working across the wipe (and lets the follow-up `push`
authenticate). Set it on the server and hand the same value to the client:

```yaml
environment:
  WEAVE_API_KEY: "a-fixed-dev-key"   # server accepts this god-key from env
```

## Wiring it into your suite

```ts
import { createClient, pushAll } from "@mauroandre/weave-sdk";
import * as entities from "./weave/entities/index.js";
import * as scopes from "./weave/scopes/index.js";

const cfg = { url: process.env.WEAVE_URL!, key: process.env.WEAVE_API_KEY! };

// once, before the whole suite
export async function globalSetup() {
  const weave = createClient({ ...cfg, entities });
  await weave.reset();                       // → virgin Postgres
  await pushAll({ ...cfg, entities, scopes }); // → rebuild schema AND scopes from code
  // ...seed through your normal create routes...
}
```

Use **`pushAll`**, not `pushEntities`: a reset wipes the scopes along with everything
else, and `pushEntities` only restores entities. On a project with scopes, rebuilding
with `pushEntities` leaves every `weave.as(scope)` failing with an unknown-scope `403` —
and the failure lands in your tests, not in the setup that caused it.

A few things worth knowing:

- **Idempotent.** Resetting an already-empty database is a harmless no-op — it ends
  in the same clean state.
- **Partitioned entities come back too.** After the rebuild, a partitioned table has
  no partitions until the first insert; the next `create` re-births the day's
  partition lazily, exactly as on a fresh table. (See
  **[Retention](/docs/aggregation)**.)
- **Nothing to clean up per test.** One reset per run gives every test the same
  baseline; between tests you just add and remove your own rows.
