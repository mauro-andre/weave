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
    // Zera o banco UMA vez antes de toda a sessão (dropa todas as tabelas).
    globalSetup: ["./tests/global-setup.ts"],
    // Os testes batem no mesmo banco `weave`; rodar os arquivos em série evita
    // corrida nas tabelas de control-plane (weave_users/weave_entities) e DDL.
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgres://weave:weave@localhost:5432/weave",
      MASTER_USERNAME: "master",
      MASTER_PASSWORD: "masterpass",
      SESSION_SECRET: "test-session-secret",
      WEAVE_API_KEY: "test-api-key",
    },
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
