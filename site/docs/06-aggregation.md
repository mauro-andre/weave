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
percentile(field, p)          // exact percentile — p is 0..1 (p95 → 0.95)
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

rows[0].revenue;              // the headline
facets.byCategory;            // [{ category, r }, ...]
```

Each facet is its own aggregate under the parent `where`. The return type **follows
your input**: with `facets`, you get `{ rows, facets }`; without, a plain array.

## Batch ingest — createMany

Insert many rows in one transaction — the shape a batched producer wants:

```ts
await weave.appRequest.createMany([
  { host: "api", route: "/x", durationMs: 12, status: 200 },
  { host: "api", route: "/y", durationMs: 40, status: 500 },
]); // → the created rows, in input order
```

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
