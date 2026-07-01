# PRD — Aggregation & Sketches

Fase que leva o Weave do CRUD para o OLAP, **sem sair do idioma de objeto**. Motivada
pela primeira app séria a dogfoodar (PodCubo/telemetria), auditada contra o inventário
real de queries dela. Princípio firme: **nunca SQL na aplicação** — se falta algo, o
Weave passa a fazer nativamente, em objeto.

É on-thesis: `aggregate`/`accumulate` são **operações de dado** (o domínio do Weave),
não plumbing (auth/storage). O relacional embaixo abre portas que o Mongo não tinha —
percentil exato, distinct exato, drill-down por evento.

## Arquitetura — C (dois tiers)

- **Recente (cru):** cada amostra é uma **linha** de evento. Retenção curta por
  **partição de tempo** (drop de partição). Agregação **exata** na leitura.
- **Histórico (rollup):** `accumulate` acumula em **sketches mergeáveis**; a leitura
  **deriva** avg/percentile/distinct dos sketches. Storage limitado.

## §0. Regra-mestra (governa o tier histórico)

**Guarda o mergeável; deriva o resto na leitura.**

- **Mergeáveis** (podem somar/unir entre rollups): `sum`, `count`, `min`, `max`,
  `histogram`, `hll`.
- **Nunca guarde pronto**: `avg`, `percentile`, `distinct`.
- **Deriva na leitura**: `avg = Σsum/Σcount` · `percentile = interpola no histograma
  somado` · `distinct = card(∪ hll)`.

Quando o `aggregate` agrupa **múltiplas linhas de rollup**, os sketch-fields
(`histogram`, `hll`) **somam/unem elemento-a-elemento** dentro do grupo — é isso que
torna o "percentil no histograma somado" mecânico. O compilador trata sketch como
mergeável no group.

## §1. Leitura — `aggregate()`

```ts
weave.<entity>.aggregate({
  where?,        // WhereInput — filtra linhas ANTES de agrupar
  groupBy?,      // string[] (campos) | { alias: expr }   — omitido/[] = conjunto inteiro
  select,        // { alias: <acumulador> }
  having?,       // WhereInput sobre os aliases do select (agregados) → HAVING
  orderBy?,      // por alias do select OU chave de grupo (inclusive computado)
  page?, perPage?,
  facets?,       // { nome: <sub-aggregate> } — sub-agregações independentes, top-N por faceta
});
```

**Acumuladores** — todos aceitam `{ where }` opcional (→ `agg(...) FILTER (WHERE …)`),
não só o `count`:

- `count()` · `sum(field)` · `avg(field)` · `min(field)` · `max(field)`
- `percentile(field, p)` — **polimórfico pelo tipo do campo**:
  - escalar cru → `percentile_cont` (**exato**, tier recente)
  - campo `histogram` → soma os baldes + interpola nas fronteiras **do tipo do campo**;
    se o alvo cai no **balde de overflow** (sem topo pra interpolar), **clampa na última
    fronteira** (ver §4)
- `histogram(field, [fronteiras])` — contagem por balde sobre escalar cru (as **barras
  de latência** do tier recente); devolve o array de contagens como **um** valor.
- `distinct(field)` — contagem **exata** de distintos (`count(distinct …)`, tier recente).
- `approxDistinct(field)` — **polimórfico** (igual `percentile`): escalar cru → estima;
  campo `hll` → une + cardinalidade.

**Expressões de grupo** (no `groupBy` mapa): `timeBucket(timeField, "5min"|"1h"|"1d")`
(alinha por **epoch/UTC**, não pelo timezone da sessão — senão "1d" desloca a fronteira
do dia) · campo puro (`"route"`).

`{ where }` geral resolve o app-vs-stack numa passada:
```ts
select: {
  appCpu:   avg("cpuAvg", { where: { name: appName } }),
  stackCpu: avg("cpuAvg"),
}
```

**Breakdowns** (país/device/browser/os) são **tier-recente**, via `groupBy` de campo
cru — ver Decisão 2. Exemplo (facets, top-N por faceta):
```ts
facets: {
  countries: { groupBy: ["country"], select: { n: count() }, orderBy: { n: "desc" }, limit: 10 },
  devices:   { groupBy: ["device"],  select: { n: count() }, orderBy: { n: "desc" }, limit: 5 },
}
```
(`limit` pressupõe `orderBy` — top-N sem ordenação é ambíguo.)

## §2. Leitura — extensão do `findMany` (estado atual)

- `findMany(where?, { latestPer: string[], orderBy })` → **greatest-n-per-group**
  (`DISTINCT ON`). Alimenta o widget de métricas vivas ("o doc mais recente por
  worker/container"). O compilador arruma a ordenação exigida; o call-site só declara
  `latestPer`.

## §3. Escrita

- **Tier recente (crítico):** `createMany(inputs[])` — insert em lote (o agente é
  produtor batelado). Evento cru = uma linha com id próprio.
- **Tier histórico (adiável):** `accumulate(key, { … })` — upsert atômico que **RETORNA
  a linha resultante** (`RETURNING`), habilitando **inc-and-return** (ex.: contador
  monotônico `getNextWorkerIndex` — incrementa e devolve o novo valor):
  ```ts
  const row = await weave.counter.accumulate({ name: "workerIndex" }, { seq: inc(1) });
  const idx = row.seq;

  await weave.appRequestsAgg.accumulate(
    { host, route, method, ts: bucket },        // chave (único composto — §5)
    {
      count: inc(1),
      durationSum: inc(dur),
      durationHistogram: addToHistogram(dur),    // incrementa o balde certo (fronteiras vêm do tipo)
      uniques: addToHll(ip),
      ts: setOnInsert(bucket),
    },
  );
  // → INSERT … ON CONFLICT (<chave>) DO UPDATE SET … RETURNING *  (atômico)
  ```
  Ops: `inc` · `addToHistogram` · `addToHll` · `setOnInsert`. **Sem `runningAvg`**
  (guarde `sum`+`count` — §0). **Sem `incKey`** (counterMap descartado — Decisão 2).

## §4. Tipos de campo (sketches mergeáveis)

- **`histogram([fronteiras])`** — UM conceito em três papéis, mesmas fronteiras:
  1. acumulador de leitura sobre escalar cru (`histogram("durationMs", [...])`);
  2. **tipo de campo** mergeável no rollup (`durationHistogram: histogram([...])`);
  3. substrato do `percentile` no tier histórico.
  Fronteiras declaradas **uma vez**, no tipo. Merge = soma elemento-a-elemento.
  ```ts
  durationHistogram: histogram([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000])
  ```
  **Balde de overflow (obrigatório):** N fronteiras → **N+1 baldes** — um por intervalo
  mais um balde **implícito acima da última fronteira** (`+∞`), que captura tudo acima do
  topo (ex.: rota lenta com p99 = 8s vive aí). Sem ele, durações > 5s somem ou colapsam
  no balde de 5000 (indistinguíveis de 4999ms) e o percentil mente.
- **`hll()`** — HyperLogLog (armazenado como `bytea` — storage já existe). Acumula
  `addToHll`; merge = união; lê via `approxDistinct(field)`.

(`counterMap` **não existe** — Decisão 2.)

## §5. Atributos de schema

- **Único/índice composto:** `unique: [["host","route","method","ts"]]` — a chave de
  rollup / alvo do `ON CONFLICT`.
- **Retenção por partição:** particiona por tempo + **drop de partição** (não sweeper de
  `DELETE`, que incha no volume). Ex.: `partitionBy: timeBucket("ts","1d")`,
  `retention: "7d"`. **Load-bearing** no tier cru.

## §6. Ordem de implementação

**Caminho crítico — Analytics recente de pé:**
`aggregate()` (count/sum/avg/min/max · `percentile` exato · `histogram`-barras ·
`distinct` · `having` · `orderBy` computado · `facets` · `groupBy` array|mapa) **+**
`timeBucket` **+** retenção por partição **+** `createMany` (ingest) **+**
`findMany.latestPer` (distinctOn).

**Tier histórico — adiável:**
`accumulate()` (com `RETURNING`) **+** único composto **+** tipo `histogram` **+** tipo
`hll` / `approxDistinct` **+** `percentile` sobre campo histograma.

**Primeiro tijolo (fatia vertical mínima):** `count`/`sum` + `groupBy` + `orderBy` — o
esqueleto do compilador de agregação. Teste de aceitação (a query real mais simples que
exercita group+order+bucket de uma vez):
```ts
weave.appRequest.aggregate({
  where: { host, ts: { gte: since } },
  groupBy: { ts: timeBucket("ts", "5min") },
  select:  { requests: count() },
  orderBy: { ts: "asc" },
});
```
Se isso ler como objeto e compilar limpo, todo o resto (percentile, histogram, facets,
having) pendura nesse esqueleto.

## Decisões registradas

1. **`accumulate` retorna a linha** (`RETURNING`) — habilita inc-and-return (contadores
   monotônicos, sequências). Mesmo primitivo de escrita, sem fire-and-forget forçado.
2. **`counterMap` descartado.** Breakdowns são **tier-recente** (`groupBy` de campo cru
   no evento). O tier histórico guarda só **3 sketches**: numérico (sum/count/min/max),
   `histogram` (percentis), `hll` (distinct). Motivo: breakdown por chave dinâmica de 30
   dias atrás é baixo valor pro custo de carregar/merge-ar counterMaps; simplifica o
   histórico e evita "agregação de mapa-dentro-de-doc" (que fugiria do idioma).
3. **`approxDistinct` polimórfico** (igual `percentile`), e sketches (`histogram`/`hll`)
   são **mergeáveis no group** — explícito no §0, o compilador os trata assim.

## Notas

- Evento cru guarda `status: int()` (não `statusGroup`) — o grupo se deriva na leitura
  (`where: { status: { gte: 500 } }`), ganhando drill-down por código. Não afeta a API
  do Weave, só a forma dos `{ where }` do consumidor.
- **Fora de escopo / futuro:** `t-digest` como alternativa ao `histogram` (percentil sem
  fronteiras fixas); continuous aggregates (rollup mantido pelo próprio Postgres).
