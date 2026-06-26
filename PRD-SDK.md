# Weave SDK — PRD

> **Status:** desenho aprovado · **Versão:** 0.1 · **Data:** 2026-06-26
> Documento de planejamento interno. Docs públicas (README) serão em inglês depois.
>
> **Este PRD descreve o _SDK_ — "a cola".** É a terceira camada do ecossistema:
> o [_engine_](./PRD.md) é o kernel (objetos→Postgres), a
> [_plataforma_](./PRD-PLATFORM.md) é o backend programável (API, scopes, admin,
> GUI), e o **SDK** é a camada de DX que deixa o dev consumir tudo isso **pensando
> em objetos TS**, sem ver HTTP, JSON ou SQL.

---

## 1. Visão

O **Weave SDK** é uma biblioteca npm (TS primeiro) que o dev instala na aplicação
dele — tipicamente um app **VeloJS** — pra falar com o Weave **só em objetos**:

> O dev escreve entidades em TS, roda a migration pelo terminal, e lê/escreve dados
> com um client **tipado**. A comunicação HTTP, o parse `obj→json`/`json→obj`, os
> headers de auth/scope e a compilação de filtros viram **invisíveis**.

O Weave é **API-first**: o SDK não é o produto, é uma **camada fina** sobre a API
HTTP que já existe (`/api`, `/admin/entities`, `/admin/scopes`). Qualquer coisa que
o SDK faça, dá pra fazer com `fetch` cru — o SDK só torna isso ergonômico e tipado.
Por isso a lib Python no futuro **não reusa código TS**: reusa o **contrato HTTP/JSON**,
que é o ativo compartilhado de verdade.

---

## 2. O problema

Sem SDK, consumir o Weave é `fetch('/api/orders', { headers, body: JSON.stringify(...) })`
+ montar filtro em JSON na mão + parsear datas/BigInt na volta + lembrar de quais
headers de scope mandar. Funciona, mas é exatamente a fricção que o resto do Weave
elimina: **voltou o "impedance mismatch", agora no transporte.**

O SDK fecha o ciclo do princípio do projeto (*nunca SQL, sempre objeto*) **até o
código do dev**:

- **ORMs** (Prisma/TypeORM) geram um client tipado, mas amarram a um schema em
  linguagem própria e a um banco que eles gerenciam.
- **Supabase-js** abstrai HTTP, mas te devolve linhas de tabela — você ainda pensa
  em tabela, e o `select('*, author(*)')` é stringly-typed.

O Weave SDK mira: **schema-as-code tipado + client de objetos aninhados + migration
declarativa pelo terminal + zero HTTP/JSON/SQL no código de aplicação.**

---

## 3. Princípio do isomorfismo (o coração do SDK)

A premissa inegociável, definida com o Mauro:

> **A forma como o dev escreve uma entidade no código tem que ser idêntica ao que
> a GUI produz e ao que o codegen gera.** Builder ↔ IR são isomórficos.

Consequência: o SDK **não tem um builder próprio** — ele reusa o **núcleo do engine**
(`defineEntity`, `t.*`, `owned`, `reference`, `mirror`, os tipos `Infer*`). O que o
designer da GUI emite (IR JSON) e o que o `defineEntity` do dev produz convergem no
**mesmo IR**. Três caminhos, um artefato:

```
GUI (designer)  ─┐
defineEntity     ─┼──→  IR (jsonb em weave_entities)  ──→  Postgres
weave gen        ─┘
```

Isso é o que garante que "fiz na GUI" e "fiz no código" nunca divergem — e o que
permite `weave pull` (puxar um schema autorado na GUI pra código) e `weave gen`
(gerar tipos/cliente a partir do schema remoto).

---

## 4. Objetivos e não-objetivos

### Objetivos (v1)

- **Schema-as-code** reusando o núcleo do engine (`defineEntity` + `t`), com
  **inferência de tipos** (`Infer`/`InferInsert`/`InferUpdate`/`InferRead`).
- **Client tipado por entidade**: `create`/`get`/`find`/`findOne`/`paginate`/`update`/`delete`.
- **`where`/`orderBy` tipados** que compilam pro filtro/sort JSON da API (incluindo
  caminhos aninhados e quantificadores `some`/`every`/`none`).
- **Serialização obj↔json** transparente: datas (ISO↔`Date`), `int8`/BigInt, e a
  **forma da reference** (`{ id }` ↔ id-form).
- **Auth + scope por requisição**: `weave.as(scope, params)` montando os headers.
- **Erros tipados** de domínio (nunca stack de SQL).
- **Migration pelo terminal**: `weave push` (declarativo, com gate de risco) + `schema.push()`.
- **Scope-as-code** (`defineScope`) via `/admin/scopes`.
- **CLI** (`weave push`/`pull`/`gen`) + `weave.config.ts`.
- **Testável** injetando `fetch = app.hono.fetch` (sem subir servidor).

### Não-objetivos (v1)

- **Não autentica.** O SDK segura a `api key` e repassa a identidade que o dev dá
  (params do scope); não quebra token. (herda D-1 da plataforma)
- **Não é ORM mágico**: sem lazy-loading, sem unit-of-work, sem query builder solto
  acoplado a SQL. A superfície é objeto, não tabela.
- **Sem Python ainda** — só TS por um bom tempo (§1).
- **Write-back inline** (codemod) não entra na v1 — é fase 1.1 (§9.4).
- **`weave gen`/`pull`** completos ficam pra fase tardia; v1 infere tipos do
  `defineEntity` local (modelo Drizzle), sem codegen obrigatório.

---

## 5. Arquitetura — o `core` puro e os pacotes

O SDK precisa do builder de schema, do `toIR` (builder→IR JSON, pro push) e dos
tipos `Infer*`. Hoje isso mora junto do servidor, que arrasta `postgres`. **Um client
npm não pode puxar o driver do Postgres.** Logo, a fundação é um **carve-out**:

```
weave/  (monorepo — npm workspaces)
├─ core/     # PURO: defineEntity, t, owned, reference, mirror,
│            #       IR types, toIR/fromIR, validateIR, Infer*.  Zero deps de runtime.
├─ engine/   # = app atual.  depende de core + postgres.  (a plataforma usa isto)
└─ sdk/      # depende de core + transporte HTTP.  Zero deps de servidor.
```

- **`core`** é o que torna o isomorfismo real: engine e SDK importam o **mesmo**
  builder e a **mesma** serialização. O IR é o contrato entre eles.
- **Pasta `/sdk`** (não `/sdk/ts` ainda — YAGNI; renomeia barato quando vier Python).
  Projeto à parte, com package.json/deps/testes próprios.
- ⚠️ **`toIR` ainda não existe** como export (o `fromIR` sim). **Ele nasce no `core`**
  e é o elo que destrava o `push`. Precisa de **testes de round-trip** builder↔IR.

> **D-5 — Carve-out do `core`.** Vira monorepo (workspaces): `core` puro
> compartilhado, `engine` e `sdk` como consumidores. Alternativa mínima descartada
> (subpath `@mauroandre/weave/schema`): o `toIR` precisa nascer limpo de qualquer jeito.

---

## 6. O que a lib abstrai

| Camada | O que faz |
|---|---|
| **Schema-as-code** | `defineEntity`/`t`/`owned`/`reference`/`mirror` + `Infer*`. Reusa o `core`. |
| **Client tipado** | `weave.<entity>.create/get/find/findOne/paginate/update/delete`. |
| **`where`/`orderBy`** | Tipados, com aninhamento e quantificadores; compilam pro JSON da API. |
| **obj↔json** | Datas (ISO↔`Date`), `int8`/BigInt, forma da reference (`{id}`↔id-form). Dirigido pelo IR. |
| **Auth + scope** | Segura `x-api-key`; `weave.as(scope, params)` monta `x-weave-scope` + `x-weave-params`. |
| **Erros tipados** | `WeaveScopeError` (403), `WeaveValidationError` (400), `WeaveReviewRequired` (409), … |
| **Migration** | `schema.push({confirm, fill})` + CLI; devolve o **plano por risco** em vocabulário de objeto. |
| **Scope-as-code** | `defineScope` via `/admin/scopes`. |

A serialização **não** é `JSON.parse` cru: tem três transformações reais (datas,
BigInt, forma da reference), e todas são **dirigidas pelo IR** — o mesmo que o
`normalizeRefs`/`buildExpand` do servidor já fazem hoje.

---

## 7. DX — estrutura de pastas e os 4 momentos

### Estrutura (1 entidade por arquivo, `export default` — convenção VeloJS)

```
minha-loja/
├─ weave/
│  ├─ entities/
│  │  ├─ category.ts          export default defineEntity("category", {...})
│  │  ├─ product.ts
│  │  └─ order.ts
│  ├─ scopes/
│  │  └─ storefront.ts        export default defineScope(...)
│  └─ _generated/client.ts    ← gerado pelo `weave gen` (você não edita)
├─ app/                       ← app VeloJS (loaders/actions usam `weave`)
├─ weave.config.ts            entities/scopes + url/key
├─ weave.lock                 (só se inlineIds = true; ver §9.4)
└─ .env                       WEAVE_URL, WEAVE_KEY
```

> **D-6 — Default export, 1:1.** Cada entidade é um arquivo com `export default
> defineEntity("nome", {...})` — consistente com o file-based do VeloJS. O **nome**
> vem do 1º argumento (não da variável). Reference se faz com default import
> (`import product from "./product.js"`). Tipo/autocomplete/highlight são idênticos
> ao named; só o nome do import é escolhido pelo dev (e o auto-import do TS resolve).

### Os 4 momentos

**1. Define** (edita arquivos — nada toca no banco)
```ts
// weave/entities/order.ts
import { defineEntity, t, owned, mirror } from "@mauroandre/weave-core";
import product from "./product.js";

export default defineEntity("order", {
  code: t.text().notNull(),
  items: owned.many(mirror(product), {
    quantity: t.int().notNull(),
    lineTotal: t.int(),
  }),
});
```

**2. Migra** (explícito, terminal — §8)
```bash
npx weave push
```

**3. Usa** (no app VeloJS — server-side; a key nunca vai pro browser)
```ts
import { weave } from "../../weave/_generated/client.js";

export const loader = async ({ query }) => {
  const products = await weave.product.paginate({
    where: { category: { name: "Books" } },   // autocomplete + tipado
    orderBy: { price: "desc" },
    page: Number(query.page ?? 1),
  });
  return { products };   // products[i].category já vem expandido e tipado
};

export const action_checkout = ({ body }) =>
  weave.order.create({ code: body.code, items: body.items });
```

**4. Deploy** — `weave push` (ou `schema.push()`) no pipeline, apontando pro Weave
de prod. Mesma mecânica, banco diferente.

> **D-7 — Client gerado.** Pra `weave.order` ser tipado, o TS precisa conhecer o
> conjunto de entidades. Sem barrel à mão, o `weave gen` **gera** o client a partir
> dos arquivos (igual o VeloJS gera a árvore de rotas). O dev importa o gerado.

---

## 8. Migration pelo terminal (o "quando migra")

A diferença-chave entre GUI e código:

- **GUI**: salvar entidade = migrar **na hora** (interativo, review sheet na tela).
- **Código**: editar arquivo **não toca no banco**. Migra-se num passo **explícito**
  — `weave push` — que diffa *tudo de uma vez* e aplica com o **mesmo gate de risco**
  (🟢🔴🟡⛔), no terminal.

```
Weave — plano de migração (loja-dev)
  🟢 order.items.discount     novo campo (opcional)
  🟡 product.sku → notNull    precisa de valor pros existentes
  ⛔ order.legacy_code        remover campo (destrutivo)

  → weave push --confirm --fill product.sku="N/A"
```

`push` é **sync declarativo**: "faça o remoto bater com meu código local". Reusa o
`diffEntityIR` + `applyEntity` que já existem (POST de IR = estado desejado, herda
D-4 da plataforma). Como a CLI sempre bate na base viva, **o IR guardado no servidor
é o ledger** — o `push` compara o source com o que o servidor já tem.

### Descoberta (como a CLI acha as entidades)

```ts
// weave.config.ts
import { defineConfig } from "@mauroandre/weave";

export default defineConfig({
  entities: "./weave/entities",   // 1 arquivo = 1 entidade (default export)
  scopes: "./weave/scopes",
  url: process.env.WEAVE_URL!,    // pra onde empurrar
  key: process.env.WEAVE_KEY!,
});
```

A CLI carrega o config, **importa o `default` de cada arquivo** da pasta (file-based,
igual o VeloJS acha rotas), lê o `.name`, monta o IR via `toIR`, e dá push. O grafo de
imports (`order`→`product`→`category`) carrega sozinho. Config e arquivos são `.ts` →
a CLI transpila on-the-fly (tsx/jiti, ou reusa o loader do Vite do projeto).

---

## 9. Ancoragem de id e rename (a seção difícil)

### 9.1 Detecção automática de rename é **impossível**

No código, a identidade de um campo é a **chave**. Renomear `name`→`title` é
indistinguível de "apagou `name`, criou `title`" — o diff só vê um drop + um add. Não
existe mecânica que adivinhe a intenção. (A GUI escapa porque **o id vai pro client**:
a linha de edição segura o id, renomear muda só o nome.) **O design nunca depende de
detecção automática.**

### 9.2 Default: **id-less**, servidor é o ledger

O dev escreve limpo, **sem id** (igual Drizzle). O servidor **herda o id por nome**
comparando o IR que chega com o IR que já guardou (`node.id ?? prev?.id ?? uuid` — já
construído, §9.5). Campo igual → herda; novo → cunha; sumiu → drop (com gate). **Não
precisa de `weave.lock` no caminho online.**

> **D-1 — Não obrigar id.** Mandar id em todo campo, pra sempre, pra resolver um
> evento raro (rename) é taxar o caso comum pelo caso raro. Id é **opcional**; o
> caso comum não paga nada.

### 9.3 Rename: sinal explícito + gate como rede

O id só importa **no rename**. Então o rename é um sinal explícito, só nesse momento:

```bash
weave push --rename product.name=title
```

O servidor ainda tem `name` (id X) → mapeia X pro novo nome. Zero id digitado, zero
codemod, zero prompt. (Ou um **prompt interativo**, estilo Drizzle, pra quem prefere.)
**Esqueceu a flag?** O gate de risco mostra "drop `name` + add `title` (destrutivo,
confirme)" — o erro é recuperável, não catastrófico. A fricção cai exatamente onde
deve: renomear é perigoso, ser deliberado ali é *feature*.

> **D-2 — Ledger = servidor; D-3 — rename via `--rename`/prompt + gate.** Sem lock no
> caminho online; o `weave_entities` é o estado anterior. Rename explícito, amparado
> pelo gate de risco que já existe.

### 9.4 Write-back inline (`inlineIds: true`) — **fase 1.1, opt-in**

Açúcar opcional pra rename **totalmente automático**: depois do push, a CLI injeta o
`$id` em cada campo do source (`t.text({ $id: "fld_77a1" }).notNull()`). Aí o id vive
no source (como na GUI), renomear a chave preserva o id, e o diff vê rename direto —
sem flag, sem prompt. Quando ligado, um `weave.lock` versionado complementa.

**Viabilidade (validada olhando o `veloPlugin`):** o velo já faz parse→mutar→gerar com
`@babel/parser` + `@babel/traverse` + `@babel/types` + `@babel/generator`, injetando
propriedades em object literals — **exatamente nossa máquina**. As diferenças: (a) o
output do velo é artefato de build, o nosso é source commitado → trocar
`@babel/generator` por **`recast`** (preserva o formato dos nós não-tocados, diff
limpo); (b) achar o ponto de injeção por campo (`t.text(...)`/`reference(...)`); (c)
lifecycle de CLI (`fs.writeFileSync` de volta — já feito no `init.ts` do velo).

> **D-4 — Write-back é opt-in, fase 1.1.** Não é requisito de v1. A máquina é
> conhecida (babel + recast), mas é a peça mais delicada (editor aberto, churn de
> git, idempotência, CI em `--check`) — construir depois do SDK andar inverte menos
> risco. v1 sem ele: id-less + `--rename`.

### 9.5 Já construído na engine (sessão de 2026-06-26)

O servidor **aceita e valida** id fornecido pelo client desde a criação — a fundação
dos três mundos (id-less, `$id` à mão, write-back), **sem mudança futura na engine**:

- **Aceita**: `ensureFieldIds` faz `node.id ?? prev?.id ?? randomUUID()`; `normalize`
  preserva via spread; `validateIR` não remove. Na criação (`previous=null`): respeita
  o fornecido, cunha o ausente.
- **Valida** (net-new): `validateIR` agora checa **unicidade de id na entidade inteira**
  (Set por toda a árvore, inclui owned aninhado) + **formato** (string não-vazia).
- **279 testes verdes**, 7 novos (`tests/entity-ids.test.ts`): nenhum/todos/misto,
  owned aninhado misto, duplicado rejeitado, vazio rejeitado, re-save estável.

---

## 10. CLI

| Comando | O quê |
|---|---|
| `weave push` | Diffa o source contra o servidor → plano por risco → aplica 🟢; pede `--confirm`/`--fill` pro resto. |
| `weave push --rename a.x=y` | Declara um rename (§9.3). |
| `weave push --check` | CI: falha se houver mudança a aplicar (não aplica). |
| `weave pull` | Puxa o schema remoto → arquivos `defineEntity` (autorado na GUI → código). |
| `weave gen` | Gera o client tipado + (se `inlineIds`) escreve os `$id` no source. |

`schema.push({confirm, fill})` é o equivalente programático do `push`, pra rodar em
deploy/CI.

---

## 11. Contrato HTTP/headers (o que o SDK fala)

Tudo já existe na plataforma (herda §5 e §6 do PRD-PLATFORM):

- **Dados**: `GET/POST/GET-one/PATCH/DELETE /api/:entity`. Auth: `x-api-key`.
- **Scope por requisição**: `x-weave-scope: <nome>` + `x-weave-params: {json}`.
  `weave.as("storefront", { accountId })` monta os dois. Sem scope = god (a key é o
  limite de confiança).
- **Admin (migration)**: `PUT /admin/entities/:name` (200 applied | 409 needsReview +
  plano), `GET`/`DELETE`; `/admin/scopes` (CRUD). **Mesma `apiKeyMiddleware`** — "é o
  mesmo dev que faz tudo".

---

## 12. Testabilidade

O SDK aceita um `fetch` injetável. Nos testes do próprio Weave (e do dev), passa-se
`fetch = app.hono.fetch` — exercita o transporte real (rotas + middlewares + handlers)
**sem subir servidor**, no mesmo motor VeloJS dos outros testes. Mantém o padrão da
casa: testar pelo caminho real, não por mocks.

---

## 13. Roadmap (fases)

> **Estratégia:** primeiro o `core` + o transporte tipado (o ciclo end-to-end), depois
> as ergonomias (where tipado, scope-as-code), e o write-back como fast-follow.

- **F0 — Carve-out do `core` + `toIR`.** Monorepo/workspaces; mover schema+IR+`Infer*`
  pro `core` puro; **nascer o `toIR`** com testes de round-trip builder↔IR. (§5)
- **F1 — Client de transporte + CRUD.** `createClient({url, key, schema, fetch?})`;
  `create/get/find/findOne/paginate/update/delete`; serialização obj↔json (datas/BigInt/
  ref-form); erros tipados. Testes com `app.hono.fetch`. (§6, §12)
- **F2 — `where`/`orderBy` tipados.** Superfície tipada que compila pro filtro/sort
  JSON (aninhado + quantificadores). (§6)
- **F3 — `schema.push` + CLI + rename.** `weave.config.ts`, descoberta por pasta,
  `weave push` (gate de risco), `--rename`/prompt, `--check`. (§8, §9.2–9.3)
- **F4 — Scope-as-code + `weave.as`.** `defineScope` → `/admin/scopes`; headers de
  scope/params no client. (§6, §11)
- **F5 — `weave gen` / `weave pull`.** Client gerado; puxar schema remoto pra código.
  Views por scope (tipos narrowed). (§7)
- **F1.1 — Write-back inline** (`inlineIds: true`). babel + recast; `$id` no source;
  `weave.lock`. (§9.4)

---

## 14. Decisões em aberto

- **D-8 — Geração de id: cliente ou servidor?** No write-back, a CLI pode cunhar local
  (e gravar no source) **ou** o servidor cunha e devolve. *Tendência:* servidor cunha
  (já faz), CLI grava o que voltou — mantém o servidor como fonte.
- **D-9 — `weave gen` obrigatório?** v1 infere do `defineEntity` local (sem codegen).
  O gen é pra client tipado sem barrel à mão e pra schema remoto. *Tendência:* opcional
  na v1, recomendado quando há muitas entidades.
- **D-10 — Loader de TS na CLI.** tsx/jiti vs. reusar o Vite do projeto. *Tendência:*
  começar com jiti (zero-config), oferecer hook pro Vite depois.
- **D-11 — `where` tipado: reusar os tipos do `read.ts`?** O engine já tem `WhereInput`
  rico. *Tendência:* sim, expor do `core` pra não duplicar.

---

## 15. Princípio norteador

> O Weave SDK é **a cola**: o ponto onde o princípio do projeto — *nunca SQL, sempre
> objeto* — alcança o código do dev. Ele não inventa um modelo novo; reusa o **mesmo
> núcleo** que a GUI e o codegen usam (builder↔IR isomórficos), e torna invisível o
> que sobra: HTTP, JSON, headers, filtros. O dev pensa em objetos TS, migra pelo
> terminal, e o Weave faz o resto. O Supabase abstrai tabelas atrás de um client; o
> Weave abstrai **objetos** — e o SDK é onde essa abstração vira DX.
