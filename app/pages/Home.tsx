import { Link } from "@mauroandre/velojs";
import { useLoader } from "@mauroandre/velojs/hooks";
import { useSignal, type Signal } from "@preact/signals";
import { Page } from "../components/Page.js";
import type { HomeStats, EntityStat } from "../engine/control-plane/home.js";
import * as css from "./Home.css.js";
import * as btn from "../styles/button.css.js";

// Colunas ordenáveis da lista de entities. `size` ordena por `bytes` (não pela string).
type SortCol = "name" | "objects" | "fields" | "size";
type Sort = { col: SortCol; dir: "asc" | "desc" };

// Overview do workspace: KPI row (entities/objects/keys/scopes) + lista de entities
// com barra de magnitude (objetos por entity) + a "sala de máquinas" do Postgres.
export const loader = async (): Promise<HomeStats> => {
  const { homeStats } = await import("../engine/control-plane/home.js");
  return homeStats();
};

// Compacta números grandes só nas TILES (headline). Nas linhas mostramos o exato.
const compact = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString();

function Tile({ num, label }: { num: string | number; label: string }) {
  return (
    <div class={css.tile}>
      <div class={css.tileNum}>{num}</div>
      <div class={css.tileLabel}>{label}</div>
    </div>
  );
}

// Uma linha da lista de entities: métricas reais alinhadas (objects · fields · size),
// sem barra. A pegada física (tables/partitioned) fica discreta, só quando expande.
function EntityRow({ e }: { e: EntityStat }) {
  return (
    <Link class={css.entityRow} to="/data" search={{ entity: e.slug }}>
      <span class={css.entityName}>{e.name}</span>
      <span class={css.num}>{e.objects.toLocaleString()}</span>
      <span class={css.numMuted}>{e.fields}</span>
      <span class={css.num}>{e.size}</span>
      <span class={css.meta}>
        {e.partitioned ? <span class={css.tag}>partitioned</span> : null}
        {e.tables > 1 ? <span>· {e.tables} tables</span> : null}
      </span>
      <span class={css.arrow}>→</span>
    </Link>
  );
}

// Header clicável de uma coluna: alterna asc/desc na coluna ativa, ou ativa a nova
// (em asc). Mostra a seta só na coluna ativa. `left` p/ name, `right` p/ as numéricas.
function SortHeader({ col, label, align, sort }: { col: SortCol; label: string; align: "left" | "right"; sort: Signal<Sort> }) {
  const active = sort.value.col === col;
  const onClick = () => {
    sort.value = active ? { col, dir: sort.value.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" };
  };
  return (
    <button
      type="button"
      onClick={onClick}
      class={`${css.sortHead} ${align === "left" ? css.sortLeft : css.sortRight} ${active ? css.sortActive : ""}`}
    >
      {label}
      {active ? <span class={css.sortArrow}>{sort.value.dir === "asc" ? "↑" : "↓"}</span> : null}
    </button>
  );
}

function sortEntities(list: EntityStat[], sort: Sort): EntityStat[] {
  const { col, dir } = sort;
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const cmp =
      col === "name" ? a.name.localeCompare(b.name) : col === "size" ? a.bytes - b.bytes : a[col] - b[col];
    return sign * cmp;
  });
}

function Engine({ val, label }: { val: string; label: string }) {
  return (
    <div class={css.engineTile}>
      <div class={css.engineVal}>{val}</div>
      <div class={css.engineLabel}>{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div class={css.empty}>
      <div class={css.emptyTitle}>No entities yet</div>
      <p class={css.emptyText}>
        An entity is a kind of object you store — <code>product</code>, <code>order</code>, <code>customer</code>. Design
        your first one and Weave maps it to Postgres for you.
      </p>
      <div class={css.emptyActions}>
        <Link class={btn.primary} to="/entities/new">
          Create an entity
        </Link>
        <Link class={btn.ghost} to="/api">
          Create an API key
        </Link>
      </div>
    </div>
  );
}

export const Component = () => {
  const { data } = useLoader<HomeStats>();
  const sort = useSignal<Sort>({ col: "name", dir: "asc" });
  const s = data.value;
  if (!s) return null; // loader ainda não resolveu (navegação SPA)
  const entities = sortEntities(s.entities, sort.value);

  return (
    <Page title="Overview">
      <div class={`${css.statRow} ${css.section}`}>
        <Tile num={s.totals.entities} label="Entities" />
        <Tile num={compact(s.totals.objects)} label="Objects" />
        <Tile num={s.totals.apiKeys} label="API keys" />
        <Tile num={s.totals.scopes} label="Scopes" />
      </div>

      <div class={css.section}>
        <div class={css.sectionHead}>
          <h2 class={css.sectionTitle}>Entities</h2>
          <Link class={css.sectionLink} to="/entities/new">
            + New entity
          </Link>
        </div>
        {s.entities.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div class={css.entityHead}>
              <SortHeader col="name" label="Name" align="left" sort={sort} />
              <SortHeader col="objects" label="Objects" align="right" sort={sort} />
              <SortHeader col="fields" label="Fields" align="right" sort={sort} />
              <SortHeader col="size" label="Size" align="right" sort={sort} />
              <span />
              <span />
            </div>
            <div class={css.entityList}>
              {entities.map((e) => (
                <EntityRow key={e.slug} e={e} />
              ))}
            </div>
          </>
        )}
      </div>

      <div class={css.section}>
        <div class={css.sectionHead}>
          <h2 class={css.sectionTitle}>PostgreSQL</h2>
          {s.postgres.database ? <span class={css.dbName}>{s.postgres.database}</span> : null}
        </div>
        <div class={css.engineRow}>
          <Engine val={s.postgres.version} label="version" />
          <Engine val={s.postgres.size} label="database size" />
          <Engine val={String(s.postgres.tables)} label="tables" />
          <Engine val={s.postgres.uptime} label="uptime" />
          <Engine val={String(s.postgres.connections)} label="connections" />
        </div>
      </div>
    </Page>
  );
};
