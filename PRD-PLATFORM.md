# Weave Platform — PRD

> **Status:** rascunho · **Versão:** 0.3 · **Data:** 2026-06-22
> Documento de planejamento da **plataforma**. O engine (a biblioteca v1) está
> especificado em [`PRD.md`](./PRD.md) e vira o *kernel* desta plataforma.
>
> **0.2 — reposicionamento:** o Weave **não** é um BaaS nem um backend completo. É
> uma **abstração do PostgreSQL que dá uma base de objetos** + uma GUI + uma API.
> Sem sistema de autenticação de usuários de app (isso é do dev); o único login é o
> da própria plataforma (estilo pgAdmin). Scopes continuam, como **feature interna
> opcional**, alimentada por uma identidade que o dev fornece.
>
> **0.3 — implementação:** o Weave é construído como **uma aplicação VeloJS normal**.
> `app/` é a app (rotas + actions + GUI); `app/engine/` é a regra de negócio que as
> actions chamam. Build = `velojs build`; testes pelo **motor do VeloJS** (actions/
> rotas), não unit. A auto-API (rotas por entidade) é declarada no `routes.tsx`.

---

## 1. Visão

A **Weave Platform** é a camada de produto em volta do engine: uma **GUI** e uma
**API** que tornam o Weave utilizável como uma **base de dados de objetos** — sem
escrever SQL, e sem precisar de um backend só pra isso.

O conceito-núcleo é o do engine: **Weave é uma abstração do PostgreSQL que te dá uma
base de objetos** — um objeto pode ser composto por várias tabelas (a árvore
`owned`), mas você só pensa no objeto. Postgres por baixo, objetos por cima. A
plataforma adiciona, em volta desse núcleo:

1. **Metastore** — a definição das entidades (a "planta") deixa de viver só em
   código TS e passa a ser **dado** no próprio Postgres (IR em `jsonb`), pra poder
   ser criada e editada **visualmente**.
2. **API automática** — cada entidade ganha rotas REST (GET/POST/PATCH/DELETE)
   orientadas a **agregado**, sem escrever código.
3. **GUI** — uma aplicação visual, estilo **pgAdmin / Mongo Compass / DBeaver** mas
   no nível de **objeto**, pra navegar nos dados, modelar entidades e administrar.
4. **Scopes (opcional)** — moldagem de acesso (linhas/campos/verbos) a partir de
   uma identidade que o **dev fornece**. Weave **não** autentica.

> **O que o Weave NÃO é:** não é um BaaS, não é um backend completo, não tem sistema
> de autenticação de usuários de aplicação. É uma **abstração do PostgreSQL** que dá
> uma base de objetos. A autenticação e a lógica da app são do **dev**; o único login
> da plataforma é o de quem entra na GUI pra administrar (estilo pgAdmin). O
> diferencial defensável é o **objeto que atravessa várias tabelas** — e a prova
> visual disso (objeto em cima, linhas constituintes embaixo) é o *killer demo*.

---

## 2. O wedge — o objeto sobre várias tabelas

| Ferramenta | O que mostra/abstrai | O que falta |
|---|---|---|
| **Supabase / PostgREST** | tabelas e linhas | sem conceito de objeto-agregado; RLS na mão; `?select=...` manual |
| **Mongo Compass** | documentos | sem relacional, sem integridade |
| **DBeaver** | tabelas | sem objeto; é admin de SQL puro |
| **Weave Platform** | **objetos** (agregado sobre N tabelas) | — |

O Weave já resolve o que nenhum deles tem: **o objeto materializado sobre várias
tabelas relacionais**. A tela "agregado em cima ↕ linhas de todas as tabelas que
o compõem embaixo, editáveis dos dois lados" é a expressão visual direta desse
conceito. **Esse é o produto.**

### 2.1 Escopo: abstração de dados, não backend (decisão 0.2)

O Weave cuida de **uma** coisa: **dados como objetos** — modelo, persistência, API
e (opcional) moldagem de acesso. Ficam **de fora, de propósito**:

- **Autenticação de usuário de app** — é do **dev** (Clerk/Auth0/a auth dele). Weave
  não autentica e não guarda usuários de app. O único login que existe é o da
  **própria plataforma** (operadores entrando na GUI, estilo pgAdmin).
- **Lógica de negócio / compute** (rotas custom, jobs) — roda na **app do dev**, no
  framework que ele quiser (Next, etc.). Weave não hospeda função.

O dev usa o Weave como **todo o seu repositório de dados** (a base de objetos) e
monta o resto com as ferramentas dele. Nada de "backend monolítico": o diferencial é
o **objeto sobre relacional**, não uma suíte de serviços de commodity.

---

## 3. O que sobrevive do engine e o que é reconceituado

Estamos numa fase de **reconceituação** — o engine v1 foi construído como
biblioteca, antes da ideia de plataforma. Nada é sagrado; o critério é "o que
serve à plataforma".

### Sobrevive praticamente intacto

- **Modelo conceitual** — dois relacionamentos (`owned` / `reference`), tudo
  relacional por baixo. É o coração e não muda (ver `PRD.md` §3).
- **Motor de leitura/escrita** — `find` (weave) e `save` (shred) já operam na
  árvore inteira, transacional, devolvendo/recebendo **JSON de dados**. A API REST
  basicamente expõe isso.
- **Filtro objeto-literal** (§9.1 do engine) — vira a query da API de graça.
- **Projeção** (§9.2 do engine) — vira o **scope de campo** (já poda objeto +
  tipo).
- **DDL / diff / sync** — viram os "botões" de criar/alterar entidade na GUI.

### É reconceituado

- **Fonte da verdade da planta** — de **código TS** para **IR em `jsonb` no
  banco** (decidido; ver §4). O `defineEntity` em TS continua existindo como *um*
  front-end de autoria, mas não é mais o único nem o canônico.
- **Forma de consumo** — de "biblioteca que você importa" para "servidor/API +
  GUI". A lib continua existindo como SDK/cliente.
- **Validação de borda** — antes "Zod opcional pós-v1"; agora vira um **validador
  nativo derivado do IR** (sem gerar Zod, sem de-para por tipo). Ver §5.1.

---

## 4. Projetos, bases e metastore

### 4.1 O container: Projeto / Base

Acima da entidade existe um container que o resto do PRD pressupunha sem nomear: o
**Projeto (Base)** — o guarda-chuva que segura as entidades e os scopes. É o
container análogo a um "projeto" / `database`.

**Decisões (0.1):**

- **Provisionamento — BYO Postgres.** A plataforma **conecta** num cluster PG que
  você fornece (com privilégio de criar base) e cria/gerencia as bases nele. Não
  sobe instâncias (orquestração fica adiada). Fiel à linhagem "Weave aponta pro seu
  PG".
- **Isolamento — um `DATABASE` por projeto.** Cada projeto = um `CREATE DATABASE`
  próprio, com seu próprio metastore. Isolamento real, `DROP DATABASE` é teardown
  limpo. Custo assumido: um pool de conexão por base (pools lazy/sob demanda).

### 4.2 Dois metastores: control plane × por-projeto

- **Control plane** — o "banco da plataforma": lista de projetos/bases, usuários do
  painel, strings de conexão/credenciais. É o que a GUI lê pra listar "suas bases".
  Vive em sua própria base.
- **Metastore por projeto** — `weave_entities`, `weave_scopes` daquele projeto.
  Vive **dentro** da base do projeto. Criar a base = `CREATE DATABASE` + bootstrap
  dessas tabelas.

### 4.3 Projeto ≠ tenant (dois níveis de isolamento)

Não confundir com a §6.2. São camadas distintas:

- **Projeto/Base** = o container (uma app inteira). Isolamento por `DATABASE`.
- **Tenant** = isolamento de **linha dentro** de um projeto (os usuários/contas da
  *sua* app), via scope `account_id = identity.accountId`.

Uma base pode ter multi-tenancy lá dentro; os dois coexistem.

### 4.4 Metastore — a planta vira dado (IR)

**Decisão (0.1):** a definição de entidade é serializada num **IR (Intermediate
Representation)** em JSON e guardada no Postgres (no metastore **do projeto**). O IR
é a **fonte da verdade**; TS e GUI são dois jeitos de produzi-lo.

### Dois níveis, dois lugares

- **A planta (metadado):** o IR, em `weave_entities.ir` (`jsonb`).
- **O dado (instâncias):** as tabelas reais (`posts`, `post_comments`, …), como
  hoje.

### Exemplo — tradução 1:1 do TS para o IR

```ts
// Autoria em TS (continua válida como front-end)
const post = defineEntity("posts", {
  title:    text().notNull(),
  author:   reference(author),         // N:1
  tags:     reference(array(tag)),     // N:N
  comments: owned(array({ body: text().notNull() })),  // 1:N
});
```

```json
// IR equivalente, guardado em weave_entities.ir
{
  "name": "posts",
  "fields": {
    "title":    { "kind": "column", "type": "text", "notNull": true },
    "author":   { "kind": "reference", "target": "authors", "cardinality": "one" },
    "tags":     { "kind": "reference", "target": "tags", "cardinality": "many" },
    "comments": { "kind": "owned", "array": true, "shape": {
      "body": { "kind": "column", "type": "text", "notNull": true }
    }}
  }
}
```

### Schema do metastore (esboço)

```sql
CREATE TABLE weave_entities (
  name        text PRIMARY KEY,
  ir          jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- (futuros: weave_scopes, weave_indexes, weave_migrations, weave_users …)
```

### Consequências de design

- O engine passa a **ler o IR** em vez do objeto TS em memória. Como o objeto TS
  de hoje já é praticamente esse IR, a mudança é pequena (trocar a origem).
- **Code-first preservado:** quem escreve em TS gera o IR e dá "push" pro banco
  (como uma migration de schema). GUI e código produzem a mesma coisa.
- Precisa de um **validador de IR** (o IR mal-formado é o novo "erro de
  compilação"), e de **diff de IR** (schema antigo → novo → migration).

---

### 4.5 Formato do IR (contrato)

O IR é um **espelho 1:1** do que o `defineEntity` expressa hoje (`ColumnConfig` +
`Reference` + `Owned`) — nada além. Confirmado contra o código (0.1):

- **Tipos não têm parâmetros.** `type` é só o **nome do catálogo** (`"text"`,
  `"int4"`, …); não há `length`/`precision` (o `PgType` não os carrega).
- **Sem bloco de índice composto/parcial.** `defineEntity(name, columns)` tem 2
  argumentos; o bloco `index().on(...)` do engine §8 não foi implementado. O IR
  **não** tem seção de índices entidade-level por enquanto — ponto de extensão
  futuro (uma chave `indexes` no topo, quando existir).
- **`id`/`createdAt`/`updatedAt` são implícitos** — o engine injeta; não aparecem
  no IR.

**Nós (por `kind`):**

```
column:    { kind:"column", type, array?, notNull?, default?, unique?, index? }
reference: { kind:"reference", target, cardinality:"one"|"many", notNull? }
owned:     { kind:"owned", array, shape, table? }
```

| Campo | Em | Origem no DSL | Default |
|---|---|---|---|
| `type` | column | `text()`, `int4()`, … (nome do catálogo) | — (obrigatório) |
| `array` | column | `array(text())` | `false` |
| `notNull` | column | `.notNull()` | `false` |
| `default` | column | `.default(x)` (presente só se declarado) | ausente |
| `unique` | column | `.unique()` | `false` |
| `index` | column | `.index()` (btree 1 coluna) | `false` |
| `target` | reference | entidade alvo (nome) | — (obrigatório) |
| `cardinality` | reference | `reference(e)` → `one`; `reference(array(e))` → `many` | — |
| `notNull` | reference | `.notNull()` (só faz sentido em `one`) | `false` |
| `array` | owned | `owned({...})` → `false`; `owned(array({...}))` → `true` | — |
| `shape` | owned | sub-shape recursiva (`{ campo: nó }`) | — |
| `table` | owned | `owned(..., { table })` (override de nome) | ausente |

**Topo:** `{ irVersion, name, fields }`.

**Exemplo completo (cobre todos os casos):**

```json
{
  "irVersion": 1,
  "name": "users",
  "fields": {
    "name":     { "kind": "column", "type": "text", "notNull": true },
    "email":    { "kind": "column", "type": "text", "notNull": true, "unique": true },
    "username": { "kind": "column", "type": "text", "notNull": true, "index": true },
    "phones":   { "kind": "column", "type": "text", "array": true, "notNull": true, "default": [] },
    "age":      { "kind": "column", "type": "int4" },
    "active":   { "kind": "column", "type": "bool", "notNull": true, "default": true },

    "city": { "kind": "reference", "target": "cities", "cardinality": "one", "notNull": false },
    "tags": { "kind": "reference", "target": "tags",   "cardinality": "many" },

    "addresses": { "kind": "owned", "array": true, "shape": {
      "street": { "kind": "column", "type": "text", "notNull": true },
      "city":   { "kind": "reference", "target": "cities", "cardinality": "one" },
      "landmarks": { "kind": "owned", "array": true, "table": "landmarks", "shape": {
        "label": { "kind": "column", "type": "text", "notNull": true }
      }}
    }}
  }
}
```

**Micro-decisões (0.1):**

1. **`irVersion` no topo** — versão do *formato* do IR (não da shape). Seguro barato
   pra migrar o formato depois (liga na D-4).
2. **Ordem dos campos = ordem das chaves do JSON** — dita a ordem das colunas no
   DDL. Sem índice de ordem explícito.
3. **Default não-JSON-nativo** — só `bigint` cai aqui; guardado como **string** e
   coagido pelo engine via `type`. (`string`/`number`/`boolean`/array vão diretos;
   `bytea` default o engine não suporta.)

### 4.6 Migration — POST de IR é o estado desejado (decisão 0.1)

Schema é dado: dar `POST` num IR novo pra uma entidade **é** o pedido de migração.
O modelo é **declarativo/idempotente** — um comportamento só, **sem taxonomia de
operações** (`renameField`/`changeType`/… não existem). "Reproduzir o que chegou,
preservando o que não mudou."

**Fluxo:**

```
POST IR (estado desejado)
  → mesmo que o salvo?  → no-op
  → materializa o IR em table specs
  → diffa CONTRA O BANCO VIVO (introspection — não contra o IR antigo)
  → classifica cada delta:
       • aditivo (coluna/tabela/índice novos)  → aplica automático
       • destrutivo (drop, mudança de tipo)    → reporta; aplica só com confirmação
  → preview do change set + DDL (generate())
  → aplica em transação + advisory lock (sync())
  → preserva o não-mudado
```

**Por que diffar contra o banco vivo, não contra o IR antigo:** o banco é a verdade
— autocorrige drift e migration parcial anterior. O IR antigo serve só pra histórico.
(Olhar IR-vs-IR diz *que* mudou, não *o que fazer*; desejado-vs-banco dá o DDL exato.)

**Rename é seguro por padrão, sem resolvê-lo.** Do diff, renomear `title`→`headline`
é indistinguível de "dropa `title` + cria `headline`". Com o aditivo-first: adiciona
`headline` (vazio, aplicado) e `title` não está no desejado → vira **drift reportado,
não dropado**. Resultado: **nenhum dado perdido** (`title` intacto, órfão; `headline`
vazio). O rename não é "esperto" (não carrega o dado), mas é seguro. **Carregar dado
num rename** é luxo opcional futuro — no máximo **um** afixo de intenção pontual
("este campo veio de `title`"), nunca um sistema de comandos.

> É, na essência, o `sync()` que o engine já tem — agora alimentado pelo IR em vez da
> shape TS.

## 5. API automática (orientada a agregado)

Cada entidade do metastore ganha rotas. Como a unidade é o **agregado**, a API é
mais ergonômica que a do PostgREST:

| Rota | Faz | Usa do engine |
|---|---|---|
| `GET /posts/:id` | devolve a árvore inteira tecida | `find` + expand |
| `GET /posts?where=…&select=…&page=2` | lista filtrada/paginada/projetada | §9.1 + §9.2 + paginate |
| `POST /posts` | cria o agregado em transação | `save` |
| `PATCH /posts/:id` | atualiza o agregado | `save` |
| `DELETE /posts/:id` | apaga o agregado (cascade) | delete |

- **Query** = o filtro objeto-literal já existente, exposto como query-param/body.
- **Projeção/scope** ativos decidem o que volta.
- **Validação** de input pelo validador nativo do IR (§5.1).

**Rotas fixas, dispatch dinâmico (decisão 0.1).** A API **não cria rota por
entidade em runtime**. Registra-se **uma vez** um conjunto wildcard
(`/api/:entity`, `/api/:entity/:id`, …); a cada requisição o handler lê
`params.entity`, resolve a entidade no **metastore** naquele instante e chama o
engine. Criar entidade na GUI = inserir linha em `weave_entities` (dado), **não**
registrar rota. O dinamismo mora no dispatch, não na tabela de rotas — mais simples
e robusto que registro dinâmico.

### 5.1 Validação de borda (sem Zod gerado)

**Decisão (0.1):** a validação de input **não** gera um schema Zod a partir do IR.
Gerar Zod exigiria um **de-para por tipo**, criaria uma **segunda fonte da verdade**
(sujeita a drift) e uma dependência de runtime — trabalho e manutenção para
reexpressar algo que o IR já descreve. Em vez disso, três camadas:

1. **Validador nativo do IR** — percorre o IR e confere o JSON de entrada
   (`typeof` vs. o `tsType` do catálogo, `notNull`, array-ness, recursão no
   `owned`). Fonte única (o IR), **sem de-para**, sem dependência, erro por campo.
   Cobre o caso comum.
2. **Postgres como autoridade final** — `unique`, FK e demais constraints o banco
   já impõe; a borda só **traduz** o erro do banco num retorno de API limpo (não
   reimplementa essas regras).
3. **Refinamento opcional plugável** — regras que o schema não expressa (formato
   de email, `min`/`max`, regex) ficam como **opt-in por campo**; quem quiser pode
   plugar um validador custom. Sem isso na planta, não há de-para algum.

---

## 6. Scopes (opcional) — moldagem de acesso

Scope é um recurso **opcional e interno** do Weave: uma forma declarativa de
**moldar o acesso** a partir de uma identidade que o **dev fornece** — Weave **não**
autentica (§6.3). São de **livre criação**: o dev cria quantos quiser, com os nomes
e regras que quiser.

Um scope é um **papel nomeado que atravessa as entidades**; para cada entidade,
define **três eixos**:

1. **Linhas** — *quais objetos* (ex.: "só os da conta X", "só os do usuário Y").
   Reusa o `where` do `find()`.
2. **Campos** — *quais partes de cada objeto* (vale pra árvore aninhada). Reusa o
   `select` (o campo não-selecionado nem existe no tipo).
3. **Verbos** — *quais operações* (read / create / update / delete).

Entidade que o scope **não lista** → **sem acesso** (`default-deny`).

Exemplo:

| Scope | Linhas | Campos | Verbos |
|---|---|---|---|
| `master` | tudo | tudo | todos |
| `admin` | `account_id = identity.accountId` | tudo | todos |
| `user` | `owner_id = identity.userId` | oculta campos sensíveis | read, update |

> **Princípio (não-negociável):** o cliente **nunca** é fonte de autoridade — a
> identidade e o scope vêm de um **caller confiável** (§6.3). O nome do scope é do
> dev; a autoridade é a identidade que o caller passou.

### 6.1 Imposição — WHERE homogêneo + RLS opcional

**Decisão (0.1):** a imposição é **homogênea numa única camada** — nada de RLS no
nível 1 e WHERE no resto.

1. **Default — WHERE injetado no _chokepoint_ do compilador.** O scope ativo
   (predicado de linha + projeção fixada) entra em **toda** query compilada, num
   ponto que `find`/`save` **não conseguem contornar** (não é opcional). Reusa a
   máquina que já existe: o filtro aninhado já desce na árvore com `EXISTS`
   correlacionado (§9.1 do engine), e a visibilidade de campo já é a **projeção**
   (§9.2). O cliente só estreita dentro do scope.
2. **Blindagem opcional — RLS gerado do IR.** Como temos o IR + o predicado, as
   políticas RLS podem ser **geradas automaticamente** e ligadas **por entidade**,
   para cenários de **acesso fora do Weave** (admin no banco direto, BI,
   multi-serviço). É o "cinto de segurança" que pega o que o app deixar passar.

> **Trade-off assumido:** no default, a fronteira de confiança é o **compilador do
> Weave** (a plataforma é o portão único). Quem precisa de garantia contra acesso
> out-of-band liga o RLS. Cada camada é homogênea por si.

**Filhos `owned` herdam o isolamento de graça.** Como o predicado entra na **raiz**
de cada query de agregado e os filhos são alcançados *através* da raiz, eles ficam
constrangidos sem precisar de `account_id` próprio. O dilema "desnormalizar vs.
subquery" só existe se a **blindagem RLS opcional** for ligada (aí sim cada tabela
precisa da sua política) — no default ele não aparece.

### 6.2 A identidade vem do dev; tenancy é só um scope

**Decisão (0.2):** o Weave **não** tem mecanismo dedicado de "tenant" — nem guarda
identidade. A identidade chega **pronta, do caller confiável do dev** (§6.3), e
tenancy é apenas um scope sobre ela.

1. Cada requisição traz uma **identidade** com atributos arbitrários — `accountId`,
   `userId`, `role`, o que o app definir — **fornecida pelo dev**.
2. Um **scope é um predicado sobre essa identidade** (reusa o filtro
   objeto-literal). Um mesmo mecanismo cobre os três casos do autor:

   | Scope | Predicado |
   |---|---|
   | `master` | `true` (vê tudo) |
   | `admin` | `account_id = identity.accountId` |
   | `user` | `owner_id = identity.userId` |

3. **Açúcar opcional:** marcar um campo como "chave de tenant" faz a plataforma
   **gerar o scope padrão** (`<campo> = identity.<attr>`) — conveniência, não um
   mecanismo separado.

Vantagem: uma ideia só (scope sobre identidade) cobre tenancy, posse e papel, sem
cravar um modelo de tenant rígido (hierarquias, apps sem tenant continuam cabendo).

Scopes são configurados **visualmente** na GUI e guardados no metastore
(`weave_scopes`).

### 6.3 Weave não autentica — a identidade vem do dev (decisão 0.2)

**Weave nunca autentica nem quebra token.** Quando o dev quer acesso por scope, é o
**backend confiável dele** que autentica o usuário, resolve a identidade
(`{ userId, accountId, role, … }`) e a passa pro Weave **já pronta** — junto com o
scope a aplicar. O Weave confia nesse caller e aplica o filtro/projeção (§6.1).

> Logo, a auto-API com scope pressupõe um **caller confiável** (o servidor do dev).
> Não existe "front não-confiável falando direto com scope": isso exigiria o Weave
> **verificar token**, e autenticar **não é função do Weave** — é do dev.

Regra de ouro: o cliente não é fonte de autoridade; o scope é aplicado a partir da
identidade que o **caller confiável** forneceu.

### 6.4 Definição de scope (DX)

Scope é uma **definição** (igual à entidade), então segue o **mesmo padrão do IR**:
pode ser autorado **code-first** (`defineScope`) **ou na GUI**, e os dois viram um
**scope-IR** guardado em `weave_scopes`.

```ts
const userScope = defineScope("user", ({ identity }) => ({
  posts: {
    where:  { authorId: identity.userId },   // mesmo filtro do find()
    select: { title: true, body: true },     // mesma projeção do find()
    verbs:  ["read", "update"],
  },
  comments: {
    where: { post: { authorId: identity.userId } },
    verbs: ["read"],
  },
  // entidades não listadas → sem acesso (default-deny)
}));
```

- **`identity` é um handle simbólico:** `identity.userId` é um placeholder que o
  engine troca pelo valor real que o caller confiável passou na requisição (§6.3).
- **Forma da identidade declarada por projeto:** o projeto declara os nomes dos
  claims que o app vai mandar (`accountId`, `userId`, `role`, …) — não é auth, é só
  pra DSL/GUI referenciá-los com autocomplete.
- **Default-deny:** entidade fora do scope = sem acesso.
- **Verbos:** `read` / `create` / `update` / `delete` — linhas e campos limitam o
  *alcance*; o verbo diz se a operação é permitida **de todo**.

---

## 7. GUI (Velo) — a aplicação visual

Mistura **Mongo Compass + DBeaver**, no nível de objeto. Módulos:

1. **Navegador de objetos** (primeiro a ser feito) — lista de entidades estilo
   DBeaver; ao clicar numa entidade, lista de objetos; ao clicar num objeto,
   painel inferior mostra **as linhas de todas as tabelas que compõem aquele
   objeto** (raiz + owned, em formato de tabela). Read-only no MVP.
2. **Edição** — editar o objeto (via `save`) e, com cuidado, as linhas cruas (ver
   decisão D-3, pois mexer em linha crua de owned fura a semântica de "replace").
3. **Designer de entidades** — criar/editar a planta visualmente (escreve o IR no
   metastore). Campos, tipos, `owned`/`reference`, índices.
4. **Designer de scopes** — uma **matriz scopes × entidades**: a célula resume o
   acesso (verbos + se há filtro/projeção), `—` = sem acesso (default-deny). Clicar
   abre o editor da tripla — verbos em chips, `where` no **mesmo construtor de
   filtro** do navegador (com tokens `identity.*`), campos numa checklist (owned/
   reference expansíveis). **Preview ao vivo:** "ver os dados como este scope" abre
   o navegador com o scope aplicado — linhas filtradas, campos mascarados.
5. **API playground** — testar as rotas geradas, com o scope ativo.
6. **Migrations** — ver o diff (IR novo vs banco) e aplicar (`sync`).

### 7.1 Identidade visual (decisão 0.1)

**Metáfora: o tear — dois fios que se entrelaçam.** O nome *Weave* (tecelagem) vira
a marca, e ela conta a tese do produto:

- **Fio azul** = o relacional / Postgres (a fundação).
- **Fio verde** = o objeto / ergonomia tipo Mongo (a camada de cima).
- **O entrelace** = o Weave. (Mapeia também nos dois relacionamentos `owned`/`reference`.)

Direção escolhida: **dois fios visíveis + teal-assinatura** (foge do "verde genérico"
estilo Supabase).

**Paleta:**

| Papel | Cor | Hex |
|---|---|---|
| Primária (entrelace) | teal/esmeralda | `#12B886` |
| Fio relacional | azul Postgres | `#2F6FEB` |
| Fio objeto | verde Mongo | `#10B981` |
| Gradiente-assinatura | azul → esmeralda | `#2563EB → #10B981` |
| Fundo (dark-first) | near-black azul-esverdeado | `#0B0F12` |

- **Dark-first** (com tema claro depois), acentos em teal.
- **Uso intencional da dualidade nos dados:** `owned` numa tonalidade, `reference`
  em outra — o usuário lê o tipo de relação pela cor, sem legenda.
- **Logomark:** dois fios (azul + verde) cruzando num nó.

**Layout:** sidebar fixa com seletor de **base/projeto** no topo; nav
**Dados · Entidades · Scopes · API · Config**. A **tela-assinatura** = o agregado num
card em cima, as linhas das tabelas constituintes em abas embaixo, com **fios sutis
ligando os campos do objeto às colunas** — vê-se o *weave* acontecendo.

**Tipografia:** UI em **Inter/Geist**; dados/IDs/SQL em **mono** (JetBrains/Geist Mono).

---

## 8. Serviços adicionais (backlog de plataforma)

Por ordem de afinidade com o modelo:

- **Auth** — fora do núcleo. Há **um** login só: o da **plataforma/GUI** (operadores
  entrando pra administrar, estilo pgAdmin; god-mode, sem permissões entre eles). A
  autenticação dos usuários **da app** é 100% do dev — Weave não é, e não vira,
  provedor de auth. (Ver §6.3 e D-1.)
- **Hooks de escrita** (before/after `save`) — encaixam porque o `save` já é
  transacional.
- **Realtime** sobre **mudança de agregado** (via logical replication) — o ângulo
  "objeto" diferencia: você assina *o post*, não *3 tabelas*.
- **Audit / history** do agregado.
- **API keys / service role**, **webhooks**, **seed / import-export**.
- **Storage de arquivos** (mais tarde; é o serviço menos "Weave").

---

## 9. Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│  GUI (Velo)  — navegar, modelar, configurar scopes, playground │
└───────────────┬──────────────────────────────────────────────┘
                │  HTTP (mesma API pública)
┌───────────────▼──────────────────────────────────────────────┐
│  API automática  — rotas por entidade, orientadas a agregado   │
│  Authz (scopes, opcional) — identidade fornecida pelo dev       │
│  Validação nativa do IR (sem Zod)                               │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  Weave Engine (kernel, v1)  — weave/shred, filtro, projeção,    │
│  DDL/diff/sync — agora lendo o IR do metastore                  │
└───────────────┬──────────────────────────────────────────────┘
                │  driver (postgres.js)
┌───────────────▼──────────────────────────────────────────────┐
│  PostgreSQL (BYO) — control plane + 1 DATABASE por projeto       │
│    (cada base: metastore weave_* + dados + RLS opcional)         │
└──────────────────────────────────────────────────────────────┘
```

### 9.1 Stack & runtime (decisão 0.3)

> **Escopo:** stack de implementação da **própria plataforma**. Não é imposição ao
> dev — quem consome a API/SDK usa o framework que quiser (Next, etc.); ver §2.1.

O Weave é construído como **uma aplicação VeloJS normal** (Hono + Preact SSR), o
framework do autor — dogfooding e controle total. A divisão é por responsabilidade:

- **`app/`** = a aplicação VeloJS: `routes.tsx`, `server.tsx`, páginas/layouts da GUI,
  e as **actions** (a borda HTTP/cookie).
- **`app/engine/`** = a **regra de negócio** que as actions chamam — o engine de
  objetos (`ddl`/`driver`/`query`/…, **agnóstico de framework**, não importa VeloJS)
  + o `control-plane/` (login da plataforma, `setup`, `weave_*`).
- **Build:** `velojs build`. (tsup/SDK só quando a GUI estiver 100% — ver D-6.)

A **GUI** usa `loader`/`action` (server-side, in-process ao engine) + `middleware`
para a identidade/scope. A **auto-API** (rotas por entidade, §5) é declarada como
**endpoints no `routes.tsx`** — assim o **motor de teste do VeloJS** as exercita
direto. **Testes** = sempre por esse motor (actions/rotas), **não unit**; os testes
do engine que já existem seguem como guarda do compilador/DDL.

---

## 10. Roadmap da plataforma (fases)

> **Estratégia: "da porta pra dentro".** Construímos a plataforma inteira **+ a
> GUI** operando sobre **JSON entrando e saindo**, sem nos importarmos ainda com
> **quem** envia/recebe (transporte HTTP, auth, identidade, SDK do dev) — isso é "da
> porta pra fora" e fica pra depois. Nesta fase o operador é god-mode (CP, sem
> permissões). O **kernel** (engine v1: find/save/diff/sync/query/projection) já
> está ✅; a GUI fala com a plataforma **in-process**.

### Da porta pra dentro (plataforma + GUI)

- ✅ **F0 — Fundação da app VeloJS.** Shell do painel (login da plataforma +
  `AdminLayout` + páginas vazias com o menu), **control-plane** (`weave_users` +
  `setup`/seed do master via `.env`), identidade visual §7.1 (vanilla-extract). Tudo
  testado pelo motor do VeloJS (`tests/auth.test.ts`).
- **F1 — Camada de IR.** `toIR` (serializar `defineEntity` → JSON), `fromIR`
  (desserializar JSON → estruturas do engine) e o **validador de IR**. TS puro, sem
  banco; espelha o `collectTables`. (§4.5)
- **F2 — Metastore + projetos.** Control plane (lista de bases + conexões), criar
  base (`CREATE DATABASE` + bootstrap `weave_*`), e o engine lendo a planta do
  `jsonb` (via `fromIR`). (§4.1–4.4)
- **F3 — Migration.** `POST` de IR = estado desejado → reconcile declarativo contra
  o banco vivo (aditivo automático / destrutivo reportado). Reusa diff/sync. (§4.6)
- **F4 — I/O de dados em JSON.** A fronteira do dado: **desserializar + validar +
  coagir** o JSON de entrada (validador nativo do IR, §5.1) e **serializar** a saída.
  `find`/`save`/`paginate`/`count` operando JSON↔objeto. Sem transporte/auth — só o
  contrato JSON, chamável in-process.
- **F5 — Scopes (mecanismo).** A tripla (linha/projeção/verbos) imposta no
  compilador (WHERE homogêneo, §6.1), alimentada por uma **identidade dada** (ainda
  sem fonte de identidade) + o designer visual de scopes.
- **F6 — GUI completa (Velo).** O painel inteiro, consumindo a plataforma
  in-process: **navegador-assinatura** (agregado ↕ linhas constituintes), edição de
  dados (objeto via `save`; linha crua = D-3), **designer de entidades** (escreve
  IR), designer de scopes, view de migration, playground. Identidade visual §7.1.

### Da porta pra fora (depois)

- **G1 — Transporte HTTP.** Expor a auto-API pública: rotas wildcard + dispatch por
  entidade (§5) sobre HTTP. (Até aqui a GUI falava in-process.)
- **G2 — Login da plataforma + contrato de identidade.** O login da GUI (operadores,
  estilo pgAdmin, god-mode). E o **contrato** pelo qual o caller confiável do dev
  passa a identidade por requisição, ligando-a aos scopes da F5. Weave **não**
  autentica usuário de app nem quebra token (§6.3).
- **G3 — SDK tipado do dev.** `push`/`pull`, cliente que reidrata na ponta (objeto
  in/out, JSON/HTTP invisível). (D-6)
- **G4 — Serviços adicionais.** Realtime de agregado, hooks in-transaction, audit,
  webhooks, storage (§8).

---

## 11. Decisões em aberto

- ✅ **D-1 — Auth (resolvida 0.2):** Weave **não autentica**. Único login = o da
  **plataforma/GUI** (operadores, god-mode, sem permissões — estilo pgAdmin). A auth
  dos usuários da app é do **dev**. Scopes (opcionais) consomem a identidade que o
  **caller confiável do dev** fornece — Weave **não** quebra token. Ver §6.3 e §8.
- ✅ **D-2 — Imposição de scope (resolvida 0.1):** **WHERE homogêneo** injetado no
  chokepoint do compilador (default), com **RLS gerado do IR como blindagem
  opcional por entidade** (acesso fora do Weave). Ver §6.1.
- **D-3 — Edição de linha crua vs. agregado:** deixar editar linhas de tabela
  owned diretamente (poder de DBeaver) fura o "replace" do agregado. *Tendência:*
  edição via objeto por padrão; linha crua como modo avançado, explícito.
- ✅ **D-4 — Migration de IR (resolvida 0.1):** modelo **declarativo** — `POST` de IR
  = estado desejado; materializa → diffa contra o **banco vivo** → aplica aditivo
  automático, reporta destrutivo (preview + confirm); preserva o não-mudado. **Sem
  taxonomia de operações.** Rename = add + drift (seguro); "rename com dado" é luxo
  futuro. Ver §4.6. (Resta, como item menor: histórico de versões do IR.)
- ✅ **D-5 — Multi-tenancy (resolvida 0.2):** tenancy é só um **scope**
  (`account_id = identity.accountId`) sobre a identidade que o **dev fornece**; sem
  mecanismo de tenant dedicado. Açúcar opcional: gerar o scope padrão de uma "chave
  de tenant". Ver §6.2.
- **D-6 — SDK/cliente:** a lib TS atual vira cliente da API (typed) além de poder
  rodar embarcada? *Tendência:* sim, cliente typed gerado do IR.

---

## 12. Princípio norteador

> A Weave Platform é o **banco de dados de objetos como produto**: você modela
> objetos, a plataforma materializa em Postgres relacional de verdade, expõe tudo
> como API, **opcionalmente** molda o acesso por scope, e te dá um painel onde se
> enxerga o objeto *e* as linhas que o compõem. O Supabase abstrai tabelas; a Weave
> abstrai
> **objetos** — esse é o salto.
