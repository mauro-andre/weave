import { db } from "./db.js";
import { listEntities } from "./entities.js";
import { listApiKeys } from "./api-keys.js";
import { listScopes } from "./scopes.js";
import { fromIR, resolveMirrors, camelize } from "@mauroandre/weave-core";
import { collectTables } from "../ddl/emit.js";

// Dados do dashboard da Home: o overview de objetos (entities + contagens) e a
// "sala de máquinas" do Postgres (versão, tamanho, tabelas, uptime, conexões).
// Só leitura, resiliente (um erro numa entity não derruba a tela). NUNCA expõe a
// connection string / senha — só o nome do banco e métricas.

export interface EntityStat {
  /** Nome lógico (camelizado, como o SDK/GUI mostram). */
  name: string;
  /** Nome armazenado (snake) — o param do `/data?entity=`. */
  slug: string;
  /** Contagem de objetos (linhas da tabela raiz). */
  objects: number;
  /** Nº de campos declarados (top-level). */
  fields: number;
  /** Tamanho em disco (raiz + owned + junções + partições), já formatado. */
  size: string;
  /** Bytes crus do disco — pra ordenar corretamente (a string `size` ordenaria errado). */
  bytes: number;
  /** Tabelas físicas que a entity ocupa (raiz + owned + junções + partições). */
  tables: number;
  partitioned: boolean;
}

export interface HomeStats {
  entities: EntityStat[];
  totals: { entities: number; objects: number; apiKeys: number; scopes: number };
  postgres: {
    version: string;
    database: string;
    size: string;
    tables: number;
    uptime: string;
    connections: number;
  };
}

type Row = Record<string, unknown>;
// Resiliente: um erro numa query (ex.: pg_stat_activity restrito) vira undefined, e o
// fallback (`?? "—"`) assume — a Home nunca quebra inteira por causa de uma métrica.
const one = async (sql: ReturnType<typeof db>, q: string, p: unknown[] = []): Promise<Row | undefined> => {
  try {
    return ((await sql.unsafe(q, p as never[])) as Row[])[0];
  } catch {
    return undefined;
  }
};

function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Base-1024 com kB/MB/GB (bate com o `pg_size_pretty`). 0 → "—".
function prettyBytes(n: number): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export async function homeStats(): Promise<HomeStats> {
  const sql = db();
  const irs = await listEntities();
  const byName = new Map(irs.map((e) => [e.name, e] as const));
  const resolved = irs.map((e) => resolveMirrors(e, byName));
  const entities = fromIR(resolved);

  // Tamanho em disco de TODAS as tabelas de public numa passada; atribuímos por entity
  // pelos nomes que já calculamos (raiz + owned + junções + partições).
  let sizeByTable = new Map<string, number>();
  try {
    const rows = (await sql.unsafe(
      `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes ` +
        `FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace ` +
        `WHERE n.nspname='public' AND c.relkind IN ('r','p')`,
    )) as { name: string; bytes: string }[];
    sizeByTable = new Map(rows.map((r) => [r.name, Number(r.bytes)]));
  } catch {
    sizeByTable = new Map();
  }

  const stats: EntityStat[] = [];
  for (const ir of resolved) {
    // Contagem de objetos (tabela raiz; particionada varre as partições). Resiliente.
    let objects = 0;
    try {
      const r = await one(sql, `SELECT count(*)::bigint AS n FROM ${ir.name}`);
      objects = Number(r?.n ?? 0);
    } catch {
      objects = 0;
    }
    // Tabelas físicas: as declaradas (raiz + owned + junções) + as partições dinâmicas.
    const declared = collectTables(entities[ir.name]!).map((t) => t.name);
    let partitions: string[] = [];
    if (ir.partitionBy) {
      const rows = (await sql.unsafe(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid ` +
          `JOIN pg_class pp ON pp.oid=i.inhparent WHERE pp.relname=$1`,
        [ir.name] as never[],
      )) as { name: string }[];
      partitions = rows.map((r) => r.name);
    }
    const names = [...declared, ...partitions];
    const bytes = names.reduce((s, n) => s + (sizeByTable.get(n) ?? 0), 0);

    stats.push({
      name: camelize(ir.name),
      slug: ir.name,
      objects,
      fields: Object.keys(ir.fields).length,
      size: prettyBytes(bytes),
      bytes,
      tables: names.length,
      partitioned: !!ir.partitionBy,
    });
  }
  stats.sort((a, b) => a.name.localeCompare(b.name)); // baseline: name asc (o client reordena)

  const [apiKeys, scopes] = [(await listApiKeys()).length, (await listScopes()).length];

  // ── Sala de máquinas do Postgres ──────────────────────────────────────────────
  const ver = String((await one(sql, `SELECT version() AS v`))?.v ?? "");
  const version = /PostgreSQL (\d+(?:\.\d+)?)/.exec(ver)?.[1];
  const dbrow = await one(
    sql,
    `SELECT current_database() AS db, pg_size_pretty(pg_database_size(current_database())) AS size`,
  );
  const tcount = await one(
    sql,
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'weave\\_%'`,
  );
  const up = await one(sql, `SELECT extract(epoch FROM now() - pg_postmaster_start_time())::bigint AS s`);
  const conn = await one(sql, `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`);

  return {
    entities: stats,
    totals: { entities: stats.length, objects: stats.reduce((s, e) => s + e.objects, 0), apiKeys, scopes },
    postgres: {
      version: version ? `PostgreSQL ${version}` : "—",
      database: String(dbrow?.db ?? ""),
      size: String(dbrow?.size ?? "—"),
      tables: Number(tcount?.n ?? 0),
      uptime: formatUptime(Number(up?.s ?? 0)),
      connections: Number(conn?.n ?? 0),
    },
  };
}
