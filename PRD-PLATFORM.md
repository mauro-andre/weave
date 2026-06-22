# Weave Platform — PRD

> **Status:** rascunho · **Versão:** 0.1 · **Data:** 2026-06-21
> Documento de planejamento da **plataforma**. O engine (a biblioteca v1) está
> especificado em [`PRD.md`](./PRD.md) e vira o *kernel* desta plataforma.

---

## 1. Visão

A **Weave Platform** transforma o Weave de uma biblioteca ORM em um **backend
completo** — um "Supabase do nosso jeito", porém com uma diferença de categoria:
o Supabase é uma camada fina sobre **tabelas**; a Weave é uma camada sobre
**objetos**.

O conceito-núcleo permanece o do engine: **Weave é uma base de dados de
objetos** — uma abstração do Postgres em que um objeto pode ser composto por
várias tabelas (a árvore `owned`), mas você só pensa no objeto. A plataforma
adiciona, em volta desse núcleo:

1. **Metastore** — a definição das entidades (a "planta") deixa de viver só em
   código TS e passa a ser **dado** no próprio Postgres (IR em `jsonb`), para que
   possa ser criada e editada **visualmente**.
2. **API automática** — cada entidade ganha rotas REST (GET/POST/PATCH/DELETE)
   orientadas a **agregado**, sem escrever código.
3. **Scopes** — modelo de permissão visual (quais objetos, quais campos, quais
   verbos), imposto no servidor.
4. **GUI** — uma aplicação visual (em **Velo**, framework do autor) para navegar
   nos dados, modelar entidades e configurar tudo. Uma mistura de **Mongo Compass
   + DBeaver**, mas no nível de **objeto**.

> **Posicionamento:** o Supabase é a referência de *categoria* (BaaS), não o que
> estamos clonando. O diferencial defensável é o **objeto que atravessa várias
> tabelas** — e a prova visual disso (objeto em cima, linhas constituintes
> embaixo) é o *killer demo* que nenhum concorrente tem.

---

## 2. O wedge (por que não é "só mais um BaaS")

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

### 2.1 Escopo: camada de abstração rica, não backend monolítico (decisão 0.1)

"Backend" são **três camadas** com donos diferentes:

1. **Dados + persistência + API + controle de acesso** (modelo de objeto, auto-API,
   scopes, navegador) — **é o Weave**. O wedge.
2. **Identidade / auth** — commodity (Clerk/Auth0/Keycloak; o dev quase sempre já
   tem). **Fora do núcleo**; módulo opcional futuro.
3. **Lógica de negócio / compute** (rotas custom, jobs) — **é a app do dev**, no
   framework que ele escolher.

**Decisão:** o Weave é a **camada 1**, **auth-agnóstico** (via o contrato de claims,
§6.3) e **agnóstico de framework**. O dev usa o Weave como **todo o seu sistema de
repositório/banco de dados** (dados, API, controle de acesso) e traz **o framework
de app que quiser** (Next, etc.) + a auth que já tem. O "dev só cuida do front"
emerge dessa composição — não de o Weave virar um monólito.

> **Por que não virar "Supabase monolítico":** auth-as-a-service é um produto crítico
> e enorme (hash, reset, OAuth, MFA, sessão…) que comoditiza o Weave contra
> incumbentes e **dilui** o diferencial do objeto. Não fechamos a porta pro
> "Supabase do nosso jeito" — ele se monta por **composição**, não por monólito.

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
**Projeto (Base)** — o guarda-chuva que segura entidades + scopes + config de
identidade. É o equivalente ao "project" do Supabase.

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
   plugar Zod ou um validador custom. Sem isso na planta, não há de-para algum.

---

## 6. Scopes (permissão) — o eixo mais delicado

Um **scope** é, por entidade, uma tripla:

1. **Predicado de linha** — *quais objetos* você enxerga (ex.: "só os da minha
   conta", "só os meus"). É multi-tenancy / visibilidade de registro.
2. **Projeção** — *quais campos* (reusa §9.2 do engine; o campo não-selecionado
   nem existe no tipo).
3. **Verbos** — *quais operações* (GET/POST/PATCH/DELETE permitidos).

Exemplo do autor, formalizado:

| Scope | Predicado de linha | Projeção | Verbos |
|---|---|---|---|
| `master` | tudo | tudo | todos |
| `admin` | `account_id = :currentAccount` | tudo | todos |
| `user` | `owner_id = :currentUser` | oculta campos sensíveis | GET, PATCH (próprios) |

> **Princípio de correção (não-negociável):** o cliente **nunca** é fonte de
> autoridade. Ele só pode **estreitar** dentro do scope ativo, jamais alargar.

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

### 6.2 Identidade first-class; tenancy é só um scope

**Decisão (0.1):** o Weave **não** tem um mecanismo dedicado de "tenant". Em vez
disso, **identidade** é first-class e tenancy é apenas um scope sobre ela.

1. A plataforma sempre tem uma **identidade corrente** (vinda do auth) com atributos
   arbitrários — `accountId`, `userId`, `role`, o que o app definir.
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

### 6.3 Entrada de identidade — quem quebra o token (decisão 0.1)

A identidade chega **por requisição**. A questão é **quem verifica o token e
resolve o scope** — a fronteira de confiança vista pela porta de entrada. Os dois
modelos não são exclusivos; o **contrato de identidade é o mesmo** (saco de claims),
muda só **quem o preenche**:

- **Modelo B — Weave quebra o token (padrão).** O cliente manda o JWT direto pra
  API; o Weave **verifica** (config de segredo/JWKS por projeto), extrai os claims e
  resolve o scope. Entrega a promessa BaaS: o **front da app fala direto** na
  auto-API. Único modo seguro quando o cliente é não-confiável (browser/mobile).
- **Modelo A — caller-confiável.** Um backend seu já fez a auth e passa
  **identidade + scope já resolvidos**; o Weave confia. Para "Weave atrás do meu
  servidor" / SDK embarcado. **Não** pode ser exposto a clientes não-confiáveis.

> **Regra de ouro:** mesmo quando a requisição "nomeia" o scope, esse nome é
> **derivado/checado contra os claims** do token — o cliente nunca escolhe `admin`
> livremente. O nome do scope é do dev (arbitrário); a autoridade é o token.

Mesmo engine, mesma régua de imposição (§6.1); só a porta de entrada difere.

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
4. **Designer de scopes** — montar as triplas de permissão visualmente.
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

- **Auth / identidade** — duas auths distintas (ver §6.3 e D-1 resolvida):
  - **CP (painel):** só um **login gate**, **sem** modelo de permissão — operadores
    são arquitetos/devs, "modo DBeaver/Compass" (god-mode).
  - **App (end-user):** a identidade que os scopes usam. Integrar/verificar primeiro
    (JWT externo); auth própria com baterias é módulo opcional futuro.
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
│  Authz (scopes)  — predicado de linha + projeção + verbos       │
│  Validação (Zod do IR)                                          │
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

### 9.1 Stack & runtime (decisão 0.1)

> **Escopo desta seção:** é a stack de **implementação da própria plataforma** (o
> painel + o servidor da API). **Não** é imposição ao dev — quem consome o Weave usa
> o framework que quiser (Next, etc.); ver §2.1.

- **Framework: VeloJS** (Hono + Preact SSR), o framework do autor — dogfooding e
  controle total.
- **GUI = Velo puro:** páginas parametrizadas (`/data/:entity/:id` etc.),
  `loader`/`action`, event streams (SSE) para sync/migration ao vivo, `middleware`
  para identidade/scope (seta `c.set("identity")`, que os handlers passam ao engine).
- **API + engine = código agnóstico de framework** (funções puras + handlers que só
  tocam o `Context` do Hono), **montado no Velo via `addRoutes`** com as rotas
  wildcard (§5). Roda como 1 deploy hoje; extraível como serviço **headless** depois
  sem reescrever.
- A GUI usa páginas/loaders estáticos do Velo (registrados em build-time); a API usa
  o escape hatch `addRoutes` (registrado no startup). Nenhum dos dois registra rota
  em runtime.

---

## 10. Roadmap da plataforma (fases)

> Ordem de construção; nada é descartado. Começamos pelo que roda quase inteiro
> sobre o engine atual e prova o conceito.

- **P0 — Navegador de objetos (read-only).** Lê plantas existentes; lista
  entidades → objetos → linhas constituintes. Usa `find` direto. **Prova visual do
  conceito.** *(decidido como ponto de partida.)*
- **P1 — Projetos + Metastore (IR).** **Control plane** (lista de bases + conexões)
  e criação de base (`CREATE DATABASE` + bootstrap do metastore). Definir o formato
  do IR, a tabela `weave_entities`, o validador e o leitor do engine a partir do
  `jsonb`. Migrar o `defineEntity` TS para emitir IR.
- **P2 — Edição de dados.** Editar o objeto via `save`; depois linha crua (com
  reconciliação da semântica de agregado).
- **P3 — API REST automática.** Rotas por entidade (CRUD de agregado) + query +
  validação Zod.
- **P4 — Scopes + Authz.** Tripla (linha/projeção/verbos), imposta no servidor
  (RLS onde der). Designer visual.
- **P5 — Auth / identidade.**
- **P6 — Designer de entidades na GUI** (criar planta visualmente).
- **P7+ — Realtime, hooks, audit, webhooks, storage.**

---

## 11. Decisões em aberto

- ✅ **D-1 — Auth (resolvida 0.1):** duas auths separadas. **CP** = login gate sem
  permissões (operadores god-mode). **App** = identidade como saco de claims;
  **integrar/verificar primeiro** (JWT externo), auth própria como módulo opcional.
  Entrada por requisição com **Modelo B padrão** (Weave quebra o token) + **Modelo A**
  (caller-confiável). Implementação no P4; não bloqueia P1–P3. Ver §6.3.
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
- ✅ **D-5 — Multi-tenancy (resolvida 0.1):** **identidade** é first-class;
  tenancy é só um **scope** (`account_id = identity.accountId`), com açúcar opcional
  pra gerar o scope padrão de uma "chave de tenant". Sem mecanismo de tenant
  dedicado. Ver §6.2.
- **D-6 — SDK/cliente:** a lib TS atual vira cliente da API (typed) além de poder
  rodar embarcada? *Tendência:* sim, cliente typed gerado do IR.

---

## 12. Princípio norteador

> A Weave Platform é o **banco de dados de objetos como produto**: você modela
> objetos, a plataforma materializa em Postgres relacional de verdade, expõe tudo
> como API, controla acesso por scope, e te dá um painel onde se enxerga o objeto
> *e* as linhas que o compõem. O Supabase abstrai tabelas; a Weave abstrai
> **objetos** — esse é o salto.
