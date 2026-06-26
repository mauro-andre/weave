import { defineConfig } from "vitest/config";
import { veloPlugin } from "@mauroandre/velojs/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { DATABASE_URL } from "./tests/global-setup";

// Config dedicada do seed de cenário. Roda pelo runner do Vitest pra reusar o
// transform do Vite (as actions importam páginas com css/jsx), e popula o banco
// chamando as MESMAS actions da GUI. Fora do `npm test` (include próprio).
export default defineConfig({
  plugins: [veloPlugin(), vanillaExtractPlugin()],
  test: {
    include: ["scripts/seed.scenario.ts"],
    globalSetup: ["./tests/global-setup.ts"], // zera o banco antes de popular
    fileParallelism: false,
    testTimeout: 600_000,
    env: {
      DATABASE_URL,
      MASTER_USERNAME: "master",
      MASTER_PASSWORD: "masterpass",
      SESSION_SECRET: "test-session-secret",
    },
  },
});
