import type { AppRoutes } from "@mauroandre/velojs";
import * as Root from "./client-root.js";
import * as Login from "./auth/Login.js";
import * as AdminLayout from "./layouts/AdminLayout.js";
import * as Home from "./pages/Home.js";
import * as Data from "./pages/Data.js";
import * as Entities from "./pages/Entities.js";
import * as EntityDesigner from "./pages/EntityDesigner.js";
import * as Scopes from "./pages/Scopes.js";
import * as Api from "./pages/Api.js";
import * as Config from "./pages/Config.js";
import { authMiddleware } from "./auth/auth.middleware.js";

// O plugin do Velo computa o fullPath parseando este array literal do `export
// default` (precisa ser literal, não referência a const).
export default [
  {
    module: Root,
    isRoot: true,
    children: [
      // Público
      { path: "/login", module: Login },
      // Protegido — authMiddleware vale pra páginas, loaders e actions abaixo
      {
        module: AdminLayout,
        middlewares: [authMiddleware],
        children: [
          { path: "/", module: Home },
          { path: "/data", module: Data },
          { path: "/entities", module: Entities },
          { path: "/entities/:name", module: EntityDesigner },
          { path: "/scopes", module: Scopes },
          { path: "/api", module: Api },
          { path: "/settings", module: Config },
        ],
      },
    ],
  },
] satisfies AppRoutes;
