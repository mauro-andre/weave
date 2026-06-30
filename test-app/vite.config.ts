import { veloPlugin } from "@mauroandre/velojs/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default {
  plugins: [veloPlugin({ appDirectory: "./app" }), vanillaExtractPlugin()],
};
