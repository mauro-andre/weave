// Config do projeto (raiz: `weave.config.ts`). Aponta pra pasta das entidades e
// pra onde empurrar. Puro (sem node) — pode ser importado de qualquer lugar.

export interface WeaveConfig {
  /** Pasta das entidades (1 arquivo = 1 entidade, `export default defineEntity(...)`). */
  entities: string;
  /** Pasta dos scopes (opcional). */
  scopes?: string;
  /** Base URL do Weave. */
  url: string;
  /** API key. */
  key: string;
}

/** Helper tipado pro `weave.config.ts` (igual `defineConfig` do Vite/Drizzle). */
export function defineConfig(config: WeaveConfig): WeaveConfig {
  return config;
}
