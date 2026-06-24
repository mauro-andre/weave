import { defineConfig } from "vitest/config";
import { veloPlugin } from "@mauroandre/velojs/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

// Um config só: o Weave é uma aplicação velojs. Os testes rodam pelo motor do
// velojs (actions + rotas), e os testes existentes do engine (regra de negócio)
// também rodam aqui.
export default defineConfig({
  plugins: [veloPlugin(), vanillaExtractPlugin()],
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgres://weave:weave@localhost:5432/weave",
      MASTER_USERNAME: "master",
      MASTER_PASSWORD: "masterpass",
      SESSION_SECRET: "test-session-secret",
    },
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
