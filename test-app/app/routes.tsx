import type { AppRoutes } from "@mauroandre/velojs";

import * as Root from "./client-root.js";
import * as Todos from "./Todos.js";

export default [
  {
    module: Root,
    isRoot: true,
    children: [{ path: "/", module: Todos }],
  },
] satisfies AppRoutes;
