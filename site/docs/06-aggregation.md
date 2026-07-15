---
description: "Rolling rows up: aggregate with groupBy (fields, dot-paths, timeBucket), accumulators (count/sum/avg/min/max/distinct/first/percentile/histogram), per-accumulator filters, expressions, having, facets, unnest, latestPer, plus accumulate (inc/setOnInsert) and time partitioning for a historical tier. Use when building a metric, chart, dashboard, report, counter, or any grouped total."
---
# Aggregation

Roll many rows into numbers — counts, sums, percentiles, breakdowns — in a single
call. Everything is pushed down to Postgres; you get plain objects back, never SQL.

```ts
import { count, percentile, timeBucket } from "@mauroandre/weave-sdk";

const series = await weave.appRequest.aggregate({
  where: { host: "api", ts: { gte: since } },
  groupBy: { ts: timeBucket("ts", "5min") },       // one row per 5-minute bucket
  select: { requests: count(), p95: percentile("durationMs", 0.95) },
  orderBy: { ts: "asc" },
});
```

## Accumulators

Import the helpers from the SDK and put them in `select`:

```ts
count()                       // number of rows
sum(field) · avg(field)       // over a numeric field
min(field) · max(field)
distinct(field)               // count of distinct values
first(field)                  // one representative per group (earliest by created_at)
percentile(field, p)          // exact percentile — p strictly between 0 and 1 (p95 → 0.95)
histogram(field, [bounds])    // bucket counts (see below)
```

Every accumulator takes an optional **`{ where }`** — a filtered aggregate, computed
in the same pass:

```ts
select: {
  total:  count(),
  errors: count({ where: { status: { gte: 500 } } }),
}
```

This inner `where` is a **reduced** grammar: scalar operators, `and`/`or`/`not`, and
dot-paths — no `some`/`every`/`none`. It's also the one filter slot that isn't typed
against the entity, so a typo'd field or an unknown operator surfaces at runtime (loudly)
rather than at compile time.

`histogram` turns N boundaries into **N+1 buckets** — one per interval plus an overflow
bucket above the last boundary — and returns the counts as one array value:

```ts
select: { bars: histogram("durationMs", [100, 200, 500]) }
// → [ <100, 100–200, 200–500, ≥500 ]
```

## groupBy — fields or a time bucket

```ts
groupBy: ["host", "route"]                    // by raw fields (aliases match the names)
groupBy: { bucket: timeBucket("ts", "1h") }   // by a time bucket — "30s" · "5min" · "1h" · "1d"
```

`timeBucket` aligns on epoch/UTC, so `"1d"` buckets don't drift with the session
timezone. Omit `groupBy` entirely to aggregate the whole set into a single row.

Group by a **reference** too — it buckets by the target's foreign key. `groupBy:
["department", "company"]` groups by `department_id` + `company_id`; you can name the
reference (`department`) or its id (`departmentId`). `latestPer` takes the reference name.

`having` and the aggregate's `orderBy` are different: they address your **select
aliases**, not fields. `having: { revenue: { gte: 100 } }` refers to the `revenue` you
selected — naming a field that isn't an alias is an error.

## Grouping through relationships — paths

Any field slot in an aggregate — `groupBy`, an accumulator's `field`, a FILTER — takes a
**dot-path** through what you own and what you reference. Weave joins the tables for you;
you never write the join.

```ts
await weave.order.aggregate({
  groupBy: ["customer.region"],          // reference → a scalar on the target
  select: { n: count(), revenue: sum("total") },
});
```

A path steps through a `reference` (N:1) or an `owned` object, to any depth —
`avg("fulfilment.cost")` (an owned object), `["customer.company.tier"]` (two hops). A
**reference at the leaf** buckets by its foreign key. Paths that share a prefix share one
join. In the array form the output alias is the path string itself, so read it back as
`row["customer.region"]`.

## Unnesting an owned list — `unnest`

Everything above rolls up **parent** rows. To roll up the **elements** of an owned list
instead — an average or a distribution per element, not per parent — name the list in
`unnest`. The aggregate then runs one row per element (Postgres' answer to Mongo's
`$unwind`), and `groupBy` / an accumulator's `field` / a FILTER address the element's fields:

```ts
const perSku = await weave.order.aggregate({
  where:   { status: "paid" },     // filters the PARENT orders
  unnest:  "items",                // one row per line item
  groupBy: ["items.sku"],
  select: {
    lines:      count(),
    qty:        sum("items.qty"),
    backorders: count({ where: { "items.status": { eq: "backordered" } } }), // a band
    label:      first("items.name"),
  },
  orderBy: { "items.sku": "asc" },
});
```

The two filters play different roles: **`where` filters the parents** (which rows' elements
count at all), while an accumulator's **`{ where }` filters the elements** (the band —
`count(… FILTER …)`). `first` gives one representative per group — the earliest element by
`created_at` — for metadata that's constant within the group (the label tied to a sku).

With `unnest` the unit of aggregation is the element, so a parent contributes as many rows
as it has elements. Counting **parents** under `unnest` therefore needs `distinct("id")`
(the parent id repeats per element). One `unnest` per call — for several lists, run one
aggregate each.

## having, orderBy & top-N

`having` filters **groups** by their aggregates; `orderBy` sorts by an output alias;
`perPage` / `page` take the top-N:

```ts
{
  groupBy: ["route"],
  select: { n: count() },
  having: { n: { gte: 100 } },   // only busy routes
  orderBy: { n: "desc" },
  perPage: 10,                    // top 10
}
```

## Expressions over aggregates

`div` · `mul` · `add` · `sub` combine aliases arithmetically, and the result is usable
in `orderBy` / `having` — so you filter and sort by a derived rate **server-side**,
before pagination:

```ts
import { count, div } from "@mauroandre/weave-sdk";

await weave.appRequest.aggregate({
  groupBy: ["route"],
  select: {
    errors:    count({ where: { status: { gte: 500 } } }),
    total:     count(),
    errorRate: div("errors", "total"),        // references the aliases by name
  },
  orderBy: { errorRate: "desc" },             // the routes that fail most, proportionally
});
```

`div` guards against divide-by-zero (`0` denominators come back as `null`). An operand
can be an alias, a number, or an inline accumulator (`div(count(...), count())`).

## Facets — many breakdowns in one pass

The dashboard case: headline numbers plus several independent breakdowns of the **same**
filtered set, in one request.

```ts
const { rows, facets } = await weave.order.aggregate({
  where: { status: "paid" },
  select: { revenue: sum("total") },
  facets: {
    byCategory: { groupBy: ["category"],  select: { r: sum("total") }, orderBy: { r: "desc" }, limit: 10 },
    byState:    { groupBy: ["shipState"], select: { n: count() },      orderBy: { n: "desc" } },
  },
});

rows[0].revenue as number;    // the headline
facets.byCategory;            // [{ category, r }, ...]
```

**The values are numbers, the type isn't yet.** A numeric accumulator (`count`, `sum`,
`avg`, `percentile`, an expression, `min`/`max` over a numeric column) comes back as a
real `number` — same as a `findMany` on the same column, no `Number(...)` needed. But an
aggregate row is still typed `Record<string, unknown>`, so annotate at the boundary
(`as number`) until the select's types are inferred. Group keys are raw JSON — a
`timeBucket` key is an ISO **string**, not a `Date`.

Each facet is its own aggregate under the parent `where`. The return type **follows
your input**: with `facets`, you get `{ rows, facets }`; without, a plain array.

## Rolling up over time — `accumulate`

Everything above reads raw rows and aggregates **on read** — exact, but it keeps every
row. When you can't keep every row forever (telemetry, metrics, counters), roll them up
as they arrive with **`accumulate`**. One call folds a data point into a running rollup
keyed by a **composite unique** — atomically, in Postgres:

```ts
import { inc, max, min, setOnInsert } from "@mauroandre/weave-sdk";

await weave.metricRollup.accumulate(
  { workerId, name, ts: bucket },                      // the key — a declared unique
  {
    sampleCount: inc(1),                               // running counter
    cpuSum:      inc(cpu),      cpuMax: max(cpu),       // sum + peak
    memSum:      inc(mem),      memMin: min(mem),       // sum + valley
    firstSeen:   setOnInsert(bucket),                  // written once, kept forever
  },
); // → the resulting row
```

The **golden rule**: store what *merges*, derive the rest on read. Keep `sum` and
`count`; compute the average when you read (`cpuSum / sampleCount`). Never store an
average — two averages can't be merged, a sum and a count always can.

### The ops

```ts
inc(n)          // col = col + n          — counters, sums (monotonic)
max(v) · min(v) // col = greatest/least   — peaks and valleys
setOnInsert(v)  // written on insert only — preserved on every later merge
```

`inc`/`max`/`min` merge in the database (`+`, `greatest`, `least`); `setOnInsert`
writes on the first insert and is left untouched afterwards. There is no
read-modify-write and no race — the whole thing is a single upsert.

### The key must be a declared unique

`accumulate` upserts on the key, so the key has to be a **unique** the entity declares —
a composite group (the rollup key) or a single `.unique()` column:

```ts
export default defineEntity(
  "metricRollup",
  {
    workerId: text().notNull(),
    name:     text().notNull(),
    ts:       timestamptz().notNull(),
    sampleCount: int4().notNull().default(0),
    cpuSum:      float8().notNull().default(0),
    cpuMax:      float8().notNull().default(0),
  },
  { unique: [["workerId", "name", "ts"]] },   // ← the ON-CONFLICT key
);
```

A key that doesn't match a declared unique is a clear error — nothing is written. Read
the rollups back with the ordinary aggregators (`sum`, `avg` over the buckets), or plain
`findMany` / `latestPer` for the raw rollup rows.

## Batch ingest — createMany

Insert many rows in one transaction — the shape a batched producer wants:

```ts
await weave.appRequest.createMany([
  { host: "api", route: "/x", durationMs: 12, status: 200 },
  { host: "api", route: "/y", durationMs: 40, status: 500 },
]); // → the created rows, in input order
```

## Retention — partition by time

A high-volume event table (requests, logs, audit trails) can't grow forever. Declare
`partitionBy` + `retention` and Weave keeps a **rolling window** for you — natively, with
zero maintenance on your side:

```ts
export default defineEntity(
  "appRequest",
  { host: text().notNull(), route: text().notNull(), ts: timestamptz().notNull(), status: int4().notNull() },
  { partitionBy: timeBucket("ts", "1d"), retention: "30d" },   // daily partitions, keep 30 days
);
```

Under the hood the table is **RANGE-partitioned** by `ts`. On each write Weave lazily
creates the partition the incoming row falls into (so a late/backfilled batch still lands
correctly), and once a new day opens it **drops** whole partitions past the retention
window — a `DROP TABLE`, not a row-by-row `DELETE` that would bloat under load. You never
run a cron or a cleanup job; it's internal to Weave. Reads (`findMany`, `aggregate`) span
all partitions transparently — Postgres prunes by the `ts` predicate.

Things to know:

- **Append-only.** The partition key rides in the primary key (`(id, ts)`), so a
  partitioned entity is insert-only — ingest with `createMany`, never `updateOne`. That's
  exactly what a raw event tier wants.
- **Past the window is skipped.** A row whose `ts` is already older than `retention` is
  dropped on ingest (its partition is gone) — `createMany` skips it and logs the count;
  a single `create` of such a row is a clear error.
- **Partitions materialize on first write.** A brand-new partitioned table has *no*
  partitions until the first row lands — the day's partition is created then, lazily. An
  empty table showing zero partitions is expected, not a problem. Insert through Weave
  (not a raw SQL `INSERT`), so it can create the partition the row needs.
- **Buckets align to UTC.** A `"1d"` bucket is a UTC day, not a local-timezone day — the
  same boundary `timeBucket("ts", "1d")` uses in `aggregate`, so the raw partitioned tier
  and your rollups agree on what "a day" is. In practice a late-local-evening event can
  land in the next UTC day's partition; that's intended.

The partition field must be a `timestamptz().notNull()`. This is a general time-series
capability — logs, metrics, events — not tied to any one domain.

## Latest per group — `latestPer`

Greatest-n-per-group: one row per key, the latest wins. It feeds live-metrics widgets
(“the most recent doc per worker”). You declare the group; Weave arranges the ordering:

```ts
await weave.worker.findMany(
  {},
  { latestPer: ["workerId"], orderBy: { ts: "desc" } }, // newest row per worker
);
```

Aggregation respects scopes just like reads — the scope's row filter is `AND`-ed into
the aggregate (and every facet) before anything is grouped.
