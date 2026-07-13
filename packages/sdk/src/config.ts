// Config do projeto (raiz: `weave.config.ts`). Decisões ESTRUTURAIS, commitadas —
// não env. URL e key são de ambiente/segredo, vêm de `WEAVE_URL`/`WEAVE_KEY`.
// Puro (sem node) — pode ser importado de qualquer lugar.

export interface WeaveConfig {
  /**
   * Pasta onde o `weave gen` materializa tudo (`entities/`, `scopes/`, `index.ts`).
   * Default: `"weave"` na raiz do projeto. Ex.: `"app/weave"`.
   */
  dir?: string;
  /**
   * Gera o `weave` como client AMBIENT (multi-tenant): resolve o scope por request via
   * `runAs`/`runAsGod` (AsyncLocalStorage), FORA de qualquer run → DENY (fail-closed).
   * Puxa `@mauroandre/weave-sdk/als` (Node). Default `false`: o client de sempre (god).
   */
  ambient?: boolean;
}

/** Helper tipado pro `weave.config.ts` (igual `defineConfig` do Vite/Drizzle). */
export function defineConfig(config: WeaveConfig = {}): WeaveConfig {
  return config;
}

/** Pasta padrão quando o config não define `dir`. */
export const DEFAULT_DIR = "weave";
