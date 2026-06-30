import { defineConfig } from "tsup";

// Build do pacote publicável (@mauroandre/weave-sdk). O `core` é EMBUTIDO no bundle
// (noExternal) — publicamos um único pacote self-contained, sem dependências de
// runtime. `cli.ts` carrega o shebang da fonte (tsup preserva e marca executável).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Embute o core (workspace, não publicado); o resto (builtins) fica externo.
  noExternal: [/@mauroandre\/weave-core/],
});
