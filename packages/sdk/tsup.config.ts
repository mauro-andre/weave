import { defineConfig } from "tsup";

// Build do pacote publicável (@mauroandre/weave-sdk). O `core` é importado como
// FONTE RELATIVA (../../core/src) — o esbuild o embute no bundle JS e o dts o compila
// como fonte interna e inlina no .d.ts, então NENHUM artefato menciona weave-core
// (que nunca é publicado). `cli.ts` carrega o shebang da fonte (tsup preserva + chmod).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  // tsconfig do build cobre sdk/src + core/src no rootDir (senão o core cai fora
  // do rootDir do dts). É o que faz o core ser inlinado nos tipos.
  tsconfig: "tsconfig.build.json",
  dts: true,
  clean: true,
  sourcemap: true,
});
