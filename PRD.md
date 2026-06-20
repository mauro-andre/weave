# Weave — PRD (Product Requirements Document)

> **Status:** rascunho · **Versão:** 0.2 · **Data:** 2026-06-19
> Documento de planejamento interno. Docs públicas (README) serão em inglês depois.

---

## 1. Visão

**Weave** é uma camada de abstração *code-first* sobre PostgreSQL na qual o
desenvolvedor **só pensa em objetos** — aninhados em quantos níveis quiser — e
**nunca escreve SQL**. A biblioteca traduz essa visão de objetos para um schema
relacional de verdade (tabelas, FKs, índices), materializa o DDL sozinha, e
**tece** (*weave*) as linhas planas do banco de volta em grafos de objetos na
leitura — daí o nome.

A fundação é 100% relacional: você ganha integridade referencial, transações
ACID e o optimizer do Postgres de graça, mas nunca enxerga nada disso em SQL.

---

## 2. O problema

O *object-relational impedance mismatch*: o banco guarda linhas planas em
tabelas, mas a aplicação pensa em grafos de objetos. As soluções existentes
forçam uma escolha ruim:

- **MongoDB**: ergonomia de objeto excelente, mas garantias relacionais fracas
  (integridade frouxa, transação multi-documento como exceção, sem optimizer
  maduro). Embute tudo por *default* — e isso vira dívida de consistência.
- **ORMs pesados** (Prisma, TypeORM): escondem o SQL atrás de camadas grossas,
  schema em linguagem própria, peso.
- **Query builders** (Kysely, Drizzle): ótimos, mas mantêm você colado no SQL e
  no modelo de linhas/tabelas.

O Weave mira o ponto que faltava: **garantias relacionais do Postgres +
ergonomia de objeto do Mongo + zero SQL no código de aplicação.**

---

## 3. Modelo conceitual (o coração do projeto)

A premissa que define o Weave, descoberta por raciocínio sobre **ciclo de vida
do dado**:

> **Tudo é relacional.** Não existe "dado embutido" como paradigma de storage.
> Por baixo, todo relacionamento é uma FK — é a natureza do banco. O que muda
> entre um relacionamento e outro não é *onde* o dado mora, é **de quem ele é**
> (posse) e **quem controla seu ciclo de vida**.

Disso saem **dois — e apenas dois — tipos de relacionamento**, ambos FK por
baixo:

### `owned` — composição

O alvo **pertence** a esta entidade. É exclusivo (não compartilhado), é criado /
editado / deletado **junto com o pai**, e morre com ele (`ON DELETE CASCADE`).
É a *parte de um agregado*.

- **Storage:** uma **tabela dedicada**, prefixada pelo caminho de posse, com FK
  apontando pro **pai imediato** e cascade.
- **Leitura:** vem **automaticamente** junto com o pai (é parte do objeto).
- **Recursivo:** um `owned` pode conter outro `owned`, em N níveis. Cada nível =
  uma tabela; o cascade desce em cadeia.

### `reference` — associação

O alvo é uma entidade **independente**, com vida própria gerida em outro lugar,
possivelmente **compartilhada** por muitos. Esta entidade apenas **aponta e lê**
— não controla a escrita nem o ciclo de vida do alvo. Deletar esta entidade
**não** deleta o alvo.

- **Storage:** uma coluna **FK** apontando pra tabela independente (sem cascade).
- **Leitura:** **sob demanda** (`expand`). Por default não arrasta o alvo.

### Comparativo

| | `owned` | `reference` |
|---|---|---|
| Posse | exclusivo do pai | independente |
| Compartilhável | não | sim |
| Ciclo de vida | morre com o pai (**cascade**) | vive sozinho (**sem cascade**) |
| Quem escreve | o pai gerencia (read **+ write**) | só read por este lado |
| Storage | tabela própria prefixada | coluna FK |
| FK aponta | filho → pai imediato | esta entidade → alvo |
| Leitura | automática (parte do agregado) | sob demanda (`expand`) |

### Por que não há "snapshot" / "persistido"

Conceitos antigos **aposentados de propósito**. "Congelar uma foto do dado"
(ex.: o preço do produto no momento da compra) **não é um paradigma de storage**
— é uma escolha de gestão de dado: uma coluna numa tabela `owned` que você
**copia uma vez no insert e nunca mais sincroniza**. Isso cabe inteiro dentro de
`owned`, sem `jsonb`, sem conceito especial. (`jsonb` continua disponível como
*tipo de coluna* para dados genuinamente sem schema — mas não é mais um
mecanismo de relacionamento.)

---

## 4. Objetivos e não-objetivos

### Objetivos (v1)

1. **Declaração de shape em TS** como única fonte da verdade, com tipagem TS
   inferida automaticamente.
2. **Materialização automática** — criar/alterar tabelas, FKs, colunas e índices
   a partir da declaração (DDL + migrations gerados).
3. **`owned` recursivo** — tabelas dedicadas, cascade em cadeia, N níveis.
4. **`reference`** — FK pra entidade independente, expandida sob demanda.
5. **Leitura como árvore de objetos** (`weave`) sem SQL, com `expand` seletivo.
6. **Escrita transacional** (`shred`) — despedaça o objeto, faz upsert da árvore
   `owned` em cascata, tudo em transação ACID.
7. **Convenções automáticas** — `id`, `createdAt`, `updatedAt` gerenciados.

### Não-objetivos (v1)

- **Não** é ORM completo: sem active-record, lazy-loading ou change-tracking de
  entidades vivas.
- **Não** suporta outro banco além do Postgres.
- **Não** expõe SQL cru como caminho principal (pode haver escotilha interna).
- **Não** reimplementa motor de migrations do zero na v1 (ver decisões abertas).
- **Não** mira paridade com Prisma/Drizzle — mira o nicho objeto-recursivo +
  zero-SQL + relacional-por-default.

---

## 5. Conceitos e terminologia

| Termo | Significado |
|---|---|
| **Entity** | Entidade de primeira classe (`defineEntity`) → tabela com `id`/timestamps. |
| **owned** | Relacionamento de composição → tabela dedicada, cascade. |
| **reference** | Relacionamento de associação → FK pra entidade independente. |
| **Shape** | Declaração TS da forma de uma entity. Fonte da verdade. |
| **Aggregate** | A raiz + toda a sua árvore `owned`. Unidade de consistência (escrita/delete como bloco). |
| **Weave (read)** | Tecer linhas planas em árvore de objetos aninhada. |
| **Shred (write)** | Despedaçar o objeto em tabelas + FKs pra gravar. |
| **expand** | Pedido explícito para seguir e carregar uma `reference` na leitura. |

---

## 6. Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Aplicação TS — só objetos, zero SQL                     │
│    defineEntity(...)     find(...)     save(...)         │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  Weave                                                    │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ Type System │  │ DDL/Migrate │  │ Query Compiler   │  │
│  │ (catálogo   │  │ (shape →    │  │ (weave/shred:    │  │
│  │  de tipos   │  │  CREATE/    │  │  shape+filtro →  │  │
│  │  do PG)     │  │  ALTER)     │  │  SQL)            │  │
│  └────────────┘  └─────────────┘  └──────────────────┘  │
└───────────────┬─────────────────────────────────────────┘
                │  driver (postgres.js / node-postgres)
┌───────────────▼─────────────────────────────────────────┐
│  PostgreSQL — tabelas, FKs, índices, transações          │
└──────────────────────────────────────────────────────────┘
```

**Referência de design — Gel (EdgeDB)**, Apache 2.0, sobre Postgres, valida a
espinha: single link → coluna FK; multi link → tabela de associação; leitura
aninhada → subqueries + agregação (não JOIN flat); schema de objeto compilado
pra SQL. O Weave segue a mesma arquitetura (objeto em cima, relacional embaixo,
compilador no meio) num escopo deliberadamente menor.

---

## 7. Sistema de tipos (Pilar 1)

A fonte da verdade é uma declaração TS **relational-aware** — **não Zod**.
Decidido: o Zod descreve *shape de valor*, não *schema relacional* (sem
vocabulário nativo pra tipo SQL exato, FK, unique, índice), e construir o gerador
de DDL sobre os internals privados do Zod é frágil (já doeu no `zodmongo`).

A base é um **catálogo dos tipos do Postgres** como objetos TS, cada um com
`{ sqlType, oid, tsType }`. Núcleo prático (~35 tipos): numéricos (`int2/4/8`,
`numeric`, `real`, `double`), texto (`text`, `varchar`, `char`), data/hora
(`timestamptz`, `timestamp`, `date`, `time`, `interval`), `boolean`, `uuid`,
`json`/`jsonb`, `bytea`, arrays. Exóticos (ranges, geométricos, network,
`tsvector`) ficam pra depois.

> **Não inventar dados crus:** OIDs do `pg-types` (`builtins`) /
> `pg_catalog.pg_type`; mapa PG→TS do Kanel/kysely-codegen. Design de "tipo como
> objeto" inspirado no `pg-core` do Drizzle (referência, não dependência).

**Validação de borda (opcional, pós-v1):** gerar um schema Zod *a partir* da
shape pra validar input de API com erro por campo — regra única, sem duplicação.

---

## 8. Storage e materialização (Pilar 2)

### Mapeamento

| Na shape | No Postgres |
|---|---|
| Escalar (`text`, `int4`, …) | coluna tipada |
| `array(escalar)` | coluna `tipo[]` |
| `reference(entity)` (N:1 / 1:1) | coluna FK (`uuid`), sem cascade |
| `reference(array(entity))` (N:N) | tabela de associação |
| `owned(obj)` (1:1) | tabela dedicada, FK pro pai + cascade |
| `owned(array(obj))` (1:N) | tabela dedicada, FK pro pai + cascade |
| `id` | `uuid` PK (ver decisão: v4 vs v7) |
| `createdAt` / `updatedAt` | `timestamptz` automáticos |

### Convenção de nomes

- **`owned`** → tabela prefixada pelo **caminho de posse**, pluralizada no 1:N:
  `user.addresses` → `user_addresses`; `user_addresses.landmarks` →
  `user_addresses_landmarks`. Deixa óbvio que é owned e evita colisão.
- **`reference` / entity independente** → nome limpo: `cities`.
- **Válvula de override:** em aninhamento profundo o nome estica; permitir
  `owned(array({...}), { table: "landmarks" })`.

### Sub-entidades `owned` têm identidade própria

Mesmo declaradas "inline", no banco são linhas → ganham `id`/`createdAt`/
`updatedAt` próprios. Não são `defineEntity` de primeira classe; são gerenciadas
pelo pai.

### Exemplo canônico

```ts
const city = defineEntity("cities", {
  name:       text().notNull(),
  population: int4(),                       // muda no tempo → reference
});

const user = defineEntity("users", {
  name:   text().notNull(),
  email:  text().notNull().unique(),
  phones: array(text()),                    // escalar repetido → text[]
  addresses: owned(array({                  // owned 1:N → user_addresses
    street: text().notNull(),
    city:   reference(city),                // → city_id → cities
    landmarks: owned(array({                // owned dentro de owned → user_addresses_landmarks
      label:       text().notNull(),
      nearestCity: reference(city),         // reference em qualquer nível
    })),
  })),
});
```

DDL materializado (4 tabelas):

```sql
CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  population int4,
  created_at timestamptz, updated_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phones text[] NOT NULL DEFAULT '{}',
  created_at timestamptz, updated_at timestamptz
);

CREATE TABLE user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- owned
  street  text NOT NULL,
  city_id uuid REFERENCES cities(id),                             -- reference
  created_at timestamptz, updated_at timestamptz
);

CREATE TABLE user_addresses_landmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id uuid NOT NULL REFERENCES user_addresses(id) ON DELETE CASCADE,  -- owned
  label text NOT NULL,
  nearest_city_id uuid REFERENCES cities(id),                                -- reference
  created_at timestamptz, updated_at timestamptz
);
```

**O agregado como unidade de consistência:** deletar um `user` → cascade apaga
`user_addresses` → cascade apaga `user_addresses_landmarks`. A árvore `owned`
inteira nasce, é escrita e morre como um bloco, numa transação. É o *aggregate
boundary* do DDD, materializado.

### DDL e migrations

Code-first: o dev nunca escreve DDL. A camada faz diff entre a shape e o estado
do banco e gera `CREATE`/`ALTER`. **Taxa residual honesta:** sobra o passo de
*revisar + aplicar* a migration (diferente do Mongo, que só dá deploy). É o único
"imposto Postgres" que sobrevive ao code-first.

---

## 9. Leitura e escrita (Pilar 3)

Sem SQL cru. A API é orientada a objeto.

### Leitura (`weave`)

```ts
const users = await find(user, {
  where:  { email: "m@x.com" },        // filtro declarativo → WHERE parametrizado
  expand: { addresses: { city: true } }, // segue references; owned já vem sempre
});
// users[0].addresses[].landmarks[]  → owned, aninhado automático
// users[0].addresses[].city         → reference, só porque foi expandida
```

- `owned` vem **automático** (é o agregado).
- `reference` só vem com `expand` (evita arrastar o banco atrás de cada FK).
- Compila pra **subqueries + agregação JSON**, devolvendo a árvore já aninhada,
  `id` como string, tipos rehidratados.
- Ciclos em `reference` seguem truncagem (herdado do `zodmongo`).

### Escrita (`shred`)

```ts
await save(user, userObject);
```

Fluxo: normaliza → **shred** (escalares→colunas, `reference`→FK, `owned`→linhas
nas tabelas filhas) → upsert da árvore `owned` em cascata → tudo em **uma
transação**. `id`/`createdAt`/`updatedAt` automáticos.

### Paginação

Herdar a ergonomia do `zodmongo` (`docs`/`docsQuantity`/`pageQuantity`/
`currentPage`), agora sobre SQL (`LIMIT`/`OFFSET` + `COUNT`).

---

## 10. Decisões em aberto

1. **Driver:** `postgres.js` (porsager) vs `node-postgres` (`pg`).
   *Tendência:* `postgres.js`.
2. **Tipo de `id`:** `uuid v7` (ordenável, bom índice) vs `v4` vs `bigint
   identity`. *Tendência:* `uuid v7`.
3. **Motor de migrations:** construir vs delegar (`node-pg-migrate`/`dbmate`) na
   v1. *Tendência:* delegar primeiro, focar no compilador.
4. **Forma da API de busca:** objeto-literal (estilo Drizzle `with`/Mongo) vs
   builder fluente. *Tendência:* objeto-literal.
5. **`owned` 1:1:** sempre tabela (uniforme) vs inline nas colunas do pai
   (evita join). *Tendência:* sempre tabela; inline como otimização futura.
6. **Verbos da API:** `owned(...)`/`reference(...)` separados vs um
   `relation(..., { owned })`. *Tendência:* verbos separados.
7. **N:N (`reference` array):** ergonomia de declaração da tabela de associação.
8. **Validação de estrutura / borda:** gerar Zod no núcleo vs plugin separado.

---

## 11. Roadmap (fases)

- **Fase 0 — Fundação:** catálogo de tipos do Postgres (objeto TS) + inferência
  de tipo TS a partir da shape.
- **Fase 1 — Materialização básica:** `defineEntity` + DDL de escalares e arrays.
  Conexão + transação.
- **Fase 2 — `owned` recursivo:** tabelas dedicadas, cascade em cadeia, N níveis;
  weave/shred da árvore owned.
- **Fase 3 — `reference`:** FK N:1/1:1, leitura com `expand`, escrita.
- **Fase 4 — N:N e ciclos:** tabela de associação + truncagem de ciclos.
- **Fase 5 — Busca avançada:** filtros ricos, ordenação, paginação.
- **Fase 6 — Migrations & DX:** diff de shape → migration, CLI, validação de
  borda opcional.

---

## 12. Prior art / referências

- **zodmongo** (`@mauroandre/zodmongo`) — antecessor espiritual; reaproveitar
  walking de schema, detecção de ciclo, convenções `id`/timestamps, paginação.
- **Gel / EdgeDB** (Apache 2.0, sobre Postgres) — referência de arquitetura
  (objeto→relacional, link→FK/join table, leitura→subquery+agregação).
- **Drizzle `pg-core`** — design de "tipo como objeto" + leitura aninhada
  (`with`).
- **Kanel / kysely-codegen / pg-to-ts** — mapas PG→TS reaproveitáveis.
- **pg-types** — OIDs (`builtins`) e parsing de wire.

---

## 13. Princípio norteador

> No lado da aplicação, você só pensa em **objetos**. Por baixo, **tudo é
> relacional** — o Postgres é a fundação sólida (integridade, transação,
> optimizer), mas você nunca o vê em SQL. Só existem duas formas de relacionar
> dado: o que **é seu** (`owned`, morre com você) e o que você **só aponta**
> (`reference`, vive sozinho). O Weave é o tear que costura os dois mundos —
> recursivamente, em quantos níveis você quiser.
