import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["app/engine/index.ts", "app/engine/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
