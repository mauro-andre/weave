import { veloPlugin } from "@mauroandre/velojs/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { docsPlugin } from "./plugins/vite-docs.js";

export default {
  plugins: [
    veloPlugin({ appDirectory: "./app" }),
    vanillaExtractPlugin({ identifiers: "short" }),
    docsPlugin(),
  ],
};
