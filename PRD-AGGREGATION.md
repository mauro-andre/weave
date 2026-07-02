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
do dia) · campo puro (`"route"`) · **caminho atravessado** (`"stack.user.name"`), que
**espelha a travessia de reference/owned do `where`**. Idem nos acumuladores:
`sum("apps.ram")` sobre owned. É **núcleo geral** (qualquer domínio relacional agrega
assim), não específico de telemetria — **desenhado agora, implementado quando o domínio
relacional migrar** (Decisão 4). Barato desenhar, caro retrofitar.

**Expressões sobre agregados (v1, núcleo geral):** aliases do `select` combinam-se
aritmeticamente via **builder** (`div`/`mul`/`add`/`sub` — JS não sobrecarrega `/`) e valem
em `orderBy`/`having`:
```ts
select: {
  errors: count({ where: { status: { gte: 400 } } }),   // deriva do `status` cru
  total:  count(),
  errorRate: div("errors", "total"),                     // referencia aliases por nome
},
orderBy: { errorRate: "desc" },   // "as rotas que mais falham, proporcionalmente"
```
O compilador **inlina a expressão do alias** por baixo (o Postgres não referencia alias de
SELECT no mesmo SELECT). Filtrar/ordenar por taxa é **server-side**, antes da paginação; só
exibir é app (Decisão 5 · Decisão 8).

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
- **Tier histórico (ops numéricas ✅, 2026-07-02):** `accumulate(key, { … })` — upsert
  atômico que **RETORNA a linha resultante** (`RETURNING`), habilitando **inc-and-return**
  (ex.: contador monotônico `getNextWorkerIndex` — incrementa e devolve o novo valor):
  ```ts
  const row = await weave.counter.accumulate({ name: "workerIndex" }, { seq: inc(1) });
  const idx = row.seq;

  await weave.appRequestsAgg.accumulate(
    { host, route, method, ts: bucket },        // chave (único composto — §5)
    {
      count: inc(1),
      durationSum: inc(dur),  durationMax: max(dur),  // sum + pico (sketch numérico)
      durationHistogram: addToHistogram(dur),    // incrementa o balde certo (fronteiras vêm do tipo)
      uniques: addToHll(ip),
      ts: setOnInsert(bucket),
    },
  );
  // → INSERT … ON CONFLICT (<chave>) DO UPDATE SET … RETURNING *  (atômico)
  ```
  Ops **feitas** (a acumulação roda **no Postgres**, nunca em JS): `inc(n)` (`col = col +
  excluded.col`) · `max(v)` / `min(v)` (`greatest` / `least` — o sketch numérico min/max do
  §0) · `setOnInsert(v)` (grava só no INSERT, **fora do `SET`** → preservado no merge). Ops
  **adiadas** (dependem dos tipos de sketch — §4, sem consumidor): `addToHistogram` ·
  `addToHll`. **Sem `runningAvg`** (guarde `sum`+`count` — §0). **Sem `incKey`** (counterMap
  descartado — Decisão 2). A chave tem que casar com um **unique declarado** (composto — §5 —
  ou coluna `.unique()`), o árbitro do `ON CONFLICT`; senão erro claro, nada é escrito.

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
- **Retenção por partição (✅ 2026-07-02):** particiona por tempo (RANGE nativo) + **drop
  de partição** (não sweeper de `DELETE`, que incha no volume). Ex.:
  `partitionBy: timeBucket("ts","1d")`, `retention: "30d"`. **Manutenção 100% interna ao
  Weave** — o app só declara. Lazy no write: garante a partição da `ts` que CHEGA (cobre
  backlog atrasado) e, ao abrir um bucket novo, dropa as expiradas (self-clocking pelo
  tráfego, sem cron/endpoint). A chave de partição entra na PK (`(id, <ts>)`) → o tier vira
  **append-only** (o que um evento cru quer). Linha com `ts` além da retenção é **pulada no
  ingest** (createMany) + logada, ou erro claro no create único. Genérico (qualquer
  série-temporal), não específico de telemetria.

## §6. Ordem de implementação

**Caminho crítico — Analytics recente de pé:**
`aggregate()` (count/sum/avg/min/max · `percentile` exato · `histogram`-barras ·
`distinct` · `having` · `orderBy` computado · `facets` · `groupBy` array|mapa) **+**
`timeBucket` **+** retenção por partição **+** `createMany` (ingest) **+**
`findMany.latestPer` (distinctOn).

**Tier histórico:**
`accumulate()` (com `RETURNING`, ops `inc`/`max`/`min`/`setOnInsert`) **✅** **+** único
composto **✅** **+** retenção por partição (§5) **✅** — **caminho crítico da telemetria
COMPLETO**. Adiável (sem consumidor de sketch): tipo `histogram` **+** tipo `hll` /
`approxDistinct` **+** `percentile` sobre campo histograma.

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

**Forma vs ordem:** a *forma* do `groupBy`/acumulador já nasce aceitando **caminho
atravessado** (Decisão 4) e **expressões sobre agregados** (Decisão 5) desde o v1 — mesmo
que o primeiro tijolo exercite só campo plano. Desenhar a forma completa agora evita
retrofit; a *implementação* de cada capacidade segue a ordem acima (relacional entra
quando o domínio relacional migrar; expressões no v1).

## §7. Push-down & não-metas

**Push-down total.** `SELECT`/`GROUP BY`/`HAVING`/`ORDER BY`/`LIMIT` vão **sempre** pro
Postgres; o app só revive linha → objeto. Explora `percentile_cont`, `FILTER (WHERE)`,
`DISTINCT ON`, `INSERT … ON CONFLICT`, `GROUPING SETS`, `width_bucket`, particionamento —
e, por baixo (o dev nunca vê), **BRIN** na tabela de eventos time-partitioned, **generated
columns** pra chave de bucket, **partial indexes**.

**Interpolação de histograma em SQL — requisito de PARIDADE entre tiers (não-negociável).**
O `percentile` sobre campo `histogram` usa **cumulative sum via window function** por
baixo, no SQL. Motivo concreto: "top rotas por p95, paginado" numa janela longa bate no
tier histórico → a ordenação por p95 tem que acontecer **no SQL, antes da paginação**. Se
a interpolação rodasse em JS, `orderBy`/`having` por p95 **quebraria** e os dois tiers
perderiam paridade. Não é estilo — é a única forma de "top-N-mais-lentas paginado"
funcionar no histórico.

**HLL / `postgresql-hll` — dependência OPT-IN e escopada, NÃO requisito global.**
O core do Weave roda em **Postgres puro**. A extensão só entra **se você declarar um campo
`hll()`** — que existe pra um caso: **únicos aproximados em janela histórica longa** (no
tier recente, `count(distinct)` exato resolve, sem HLL). Sobrevive à lente do counterMap
**porque "visitantes únicos" é métrica de manchete** (está na UI, o seletor de período
cobre). **Preço registrado:** quem usa `hll()` precisa da extensão no *seu* Postgres (a
imagem do Weave pode incluí-la; gerenciado nem sempre). **Escape** (se um dia incomodar):
escopar uniques só pro tier recente e **dropar o HLL inteiro** — igual ao counterMap.
Sem a extensão, o Weave segue 100% menos esse campo.

**Não-metas do v1 (conscientes):**
- **Window functions user-facing** (running-total, rank, moving-avg) — o cliente renderiza
  a série; **parked**. Distinto do **cumsum interno pro percentile** (esse é **needed-now**,
  detalhe de implementação do compilador no caminho crítico — ver acima).
- (Agregação relacional e expressões-sobre-agregados **não** são não-metas: a 1ª é
  design-agora, a 2ª é v1.)

## Decisões registradas

1. **`accumulate` retorna a linha** (`RETURNING`) — habilita inc-and-return (contadores
   monotônicos, sequências). Mesmo primitivo de escrita, sem fire-and-forget forçado.
   **Implementado (2026-07-02)** com ops `inc`/`max`/`min`/`setOnInsert`; `max`/`min` são o
   mesmo nome do acumulador de leitura, **overloaded pelo tipo do arg** (campo `string` →
   read `percentile_cont`-style; valor `number` → write op). A chave = **unique declarado**
   (composto ou coluna `.unique()`), o árbitro do `ON CONFLICT`.
2. **`counterMap` descartado.** Breakdowns são **tier-recente** (`groupBy` de campo cru
   no evento). O tier histórico guarda só **3 sketches**: numérico (sum/count/min/max),
   `histogram` (percentis), `hll` (distinct). Motivo: breakdown por chave dinâmica de 30
   dias atrás é baixo valor pro custo de carregar/merge-ar counterMaps; simplifica o
   histórico e evita "agregação de mapa-dentro-de-doc" (que fugiria do idioma).
3. **`approxDistinct` polimórfico** (igual `percentile`), e sketches (`histogram`/`hll`)
   são **mergeáveis no group** — explícito no §0, o compilador os trata assim.
4. **Agregação relacional desenhada agora** (núcleo geral). `groupBy`/acumuladores aceitam
   caminho atravessado, espelhando o `where` (`groupBy: ["stack.user.name"]`,
   `sum("apps.ram")`). Implementa quando o domínio relacional migrar; desenhar agora é
   barato, retrofitar é caro.
5. **Expressões sobre agregados = v1** (não parked), núcleo geral. Aritmética entre aliases
   do `select`, usável em `orderBy`/`having` (ex.: ordenar por `count({ where: { status:
   { gte: 400 } } }) / count()` — taxa de erro derivada do `status`). Filtrar/ordenar por
   taxa é server-side (antes da paginação); só exibir é app.
6. **Push-down total** (§7). Interpolação de histograma **em SQL** como requisito de
   paridade entre tiers (via cumsum-window interno). `postgresql-hll` é **opt-in/gated**
   ao campo `hll()`, **não requisito global** — core roda em Postgres puro; escape =
   uniques recent-only + dropar HLL. **Window functions user-facing = não-meta v1**
   (parked), distinta do cumsum-interno-pro-percentile (needed-now).
7. **Forma de retorno do `facets`: wire uniforme + SDK auto-tipado.** O HTTP devolve
   **sempre** `{ rows, facets }` (`facets: {}` quando não há) — contrato estável pra
   qualquer consumidor REST. O **SDK** dá o açúcar: o tipo de retorno se auto-ajusta ao
   input (igual o `expand`) — sem `facets` no input → `AggregateRow[]` pelado; com →
   `{ rows, facets }`. Trava a forma cedo (antes dos call-sites ossificarem no `rows[]`)
   e settla a peça mais geral (multi-breakdown) antes das expressões. Cada faceta roda
   como **outro `aggregate` herdando o `where` do pai** (o `limit` da faceta → `perPage`);
   o compilador não muda — a orquestração é no control-plane.
8. **Expressões sobre agregados (Decisão 5) usam um BUILDER, não o `/` literal.** JS não
   sobrecarrega `/`, então `sum("errors") / count()` do exemplo nunca compilaria — a API é
   `div(...)` · `mul(...)` · `add(...)` · `sub(...)`, referenciando **aliases do select por
   nome** (`div("errors", "total")`, lê melhor que re-inlinar acumuladores). O Postgres não
   referencia alias de SELECT no mesmo SELECT, então o compilador **inlina a expressão do
   alias** por baixo (açúcar resolvido em compile-time, não alias-de-SQL real). Operando
   também pode ser **número** (bindado) ou **acumulador inline** (`div(count(...), count())`).
   Vale em `orderBy` (alias de saída) e `having` (inlinado) server-side. `div` protege com
   `nullif(b,0)` + cast `::numeric`. **Implementado.**

## Notas

- Evento cru guarda `status: int()` (não `statusGroup`) — o grupo se deriva na leitura
  (`where: { status: { gte: 500 } }`), ganhando drill-down por código. Não afeta a API
  do Weave, só a forma dos `{ where }` do consumidor.
- **Fora de escopo / futuro:** `t-digest` como alternativa ao `histogram` (percentil sem
  fronteiras fixas); continuous aggregates (rollup mantido pelo próprio Postgres).

## Checklist de implementação (status: 2026-07-02)

Legenda: ✅ feito · ⬜ não feito · 🎨 desenhado, impl. adiada por decisão.

### Tier recente — leitura (`aggregate()`) — §1
- [x] `count` · `sum` · `avg` · `min` · `max`
- [x] `distinct(field)` — `count(distinct …)` exato
- [x] `percentile(field, p)` — escalar/exato (`percentile_cont` WITHIN GROUP)
- [x] `histogram(field, [bounds])` — barras (N+1 baldes, overflow +∞)
- [x] `{ where }` por acumulador → `FILTER (WHERE …)`
- [x] `groupBy` array **e** mapa (`alias → campo | expr`)
- [x] `timeBucket(field, interval)` — epoch/UTC
- [x] `having` — sobre aliases de acumulador **e** de expressão
- [x] `orderBy` — por alias de saída (inclusive computado)
- [x] `page` / `perPage` — top-N paginado
- [x] `facets` — breakdowns numa passada (wire `{rows,facets}` + SDK auto-tipado — Decisão 7)
- [x] Expressões sobre agregados — `div/mul/add/sub` (Decisão 5/8)
- [ ] 🎨 Caminho atravessado (relacional) em `groupBy`/acumuladores (`"stack.user.name"`, `sum("apps.ram")`) — forma desenhada, impl. quando o domínio relacional migrar (Decisão 4)

### Tier recente — leitura (`findMany`) — §2
- [x] `findMany(where?, { latestPer, orderBy })` — `DISTINCT ON` (métricas vivas)

### Tier recente — escrita — §3
- [x] `createMany(inputs[])` — ingest em lote (uma transação)

### Schema — §5 (peça geral, valor imediato fora da telemetria)
- [x] Único composto — `defineEntity(name, cols, { unique: [[...]] })`
- [x] Índice composto — `{ index: [[...]] }` (mesmo maquinário)
- [x] Membro reference N:1 → coluna `<campo>_id`; validação (owned/N:N/inexistente → erro)
- [x] Migração: add unique composto = **blocked** se duplicata; drop/index = auto
- [x] Retenção por partição (`partitionBy: timeBucket(...)`, `retention`, drop de partição) — RANGE nativo, PK `(id, ts)` (append-only), `ensure-partition` lazy pela ts do evento + drop das expiradas no rollover, **interno ao Weave** (zero cron/endpoint), skip+log além da retenção (2026-07-02)

### Tier histórico — escrita — §3
- [x] `accumulate(key, { … })` — upsert atômico `ON CONFLICT … DO UPDATE … RETURNING *` (2026-07-02; merge no Postgres, sem lógica JS)
- [x] Op `inc(n)` — `col = col + excluded.col`
- [x] Op `max(v)` / `min(v)` — `greatest` / `least` (sketch numérico min/max, §0)
- [x] Op `setOnInsert(v)` — grava no INSERT, **fora do `SET`** (preservado no merge)
- [x] Chave = unique declarado (composto ou coluna `.unique()`), árbitro do `ON CONFLICT`; erro claro se não casa
- [ ] Op `addToHistogram(v)` (depende do tipo `histogram` — §4, adiável, sem consumidor)
- [ ] Op `addToHll(v)` (depende do tipo `hll` — §4, adiável, sem consumidor)

### Tier histórico — tipos de campo (sketches mergeáveis) — §4
- [ ] **Tipo** `histogram([bounds])` como campo mergeável (merge = soma elemento-a-elemento) — hoje só existe como acumulador de leitura
- [ ] `percentile` **sobre campo histograma** — interpolação em SQL via cumsum-window (§7, paridade entre tiers)
- [ ] **Tipo** `hll()` — HyperLogLog em `bytea` (precisa `postgresql-hll`, opt-in/gated — Decisão 6)
- [ ] `approxDistinct(field)` — polimórfico (escalar estima / campo `hll` une)

### Push-down & infra — §7
- [x] Push-down de `SELECT/GROUP BY/HAVING/ORDER BY/LIMIT` pro Postgres (o app só revive linha)
- [ ] Interpolação de histograma em SQL (cumsum-window) — necessária pro percentile sobre campo histograma
- [ ] `postgresql-hll` opt-in/gated ao campo `hll()`

### Não-metas v1 (conscientes)
- [ ] ⛔ Window functions user-facing (running-total/rank/moving-avg) — **parked** por decisão
- [ ] ⛔ Campo derivado (equivalente ao `.transform()` do Zod) — **fora de escopo**, é do consumidor

**Resumo (2026-07-02):** o **caminho crítico da telemetria está COMPLETO** — read do tier-recente + ingest (§1, §2, §3-recente), único/índice composto (§5), **`accumulate` numérico** (§3-histórico: `inc`/`max`/`min`/`setOnInsert`, `RETURNING`, merge no Postgres) e **retenção por partição** (§5: RANGE nativo, append-only, manutenção interna) — tudo ✅. O PodCubo pode fiar a telemetria inteira. Adiável, sem consumidor: os **sketches** (tipos `histogram`/`hll`, `addToHistogram`/`addToHll`, `approxDistinct`, percentile-sobre-histograma) e a **agregação relacional** (design-agora/impl-depois).
