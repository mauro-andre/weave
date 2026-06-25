import type { AppRoutes } from "@mauroandre/velojs";
import * as Root from "./client-root.js";
import * as Login from "./auth/Login.js";
import * as AdminLayout from "./layouts/AdminLayout.js";
import * as Home from "./pages/Home.js";
import * as Data from "./pages/Data.js";
import * as Entities from "./pages/Entities.js";
import * as EntityDesigner from "./pages/EntityDesigner.js";
import * as Scopes from "./pages/Scopes.js";
import * as ScopeDesigner from "./pages/ScopeDesigner.js";
import * as Api from "./pages/Api.js";
import * as Config from "./pages/Config.js";
import * as DataApi from "./api/handlers.js";
import { authMiddleware } from "./auth/auth.middleware.js";
import { apiKeyMiddleware } from "./api/api-key.middleware.js";

// O plugin do Velo computa o fullPath parseando este array literal do `export
// default` (precisa ser literal, não referência a const).
export default [
  {
    module: Root,
    isRoot: true,
    children: [
      // Público
      { path: "/login", module: Login },
      // API REST pública (god-mode, x-api-key). É o chokepoint dos scopes (F5).
      { path: "/api/:entity", method: "GET", handler: DataApi.apiList, middlewares: [apiKeyMiddleware] },
      { path: "/api/:entity", method: "POST", handler: DataApi.apiCreate, middlewares: [apiKeyMiddleware] },
      { path: "/api/:entity/:id", method: "GET", handler: DataApi.apiGetOne, middlewares: [apiKeyMiddleware] },
      { path: "/api/:entity/:id", method: "PATCH", handler: DataApi.apiUpdate, middlewares: [apiKeyMiddleware] },
      { path: "/api/:entity/:id", method: "DELETE", handler: DataApi.apiDelete, middlewares: [apiKeyMiddleware] },
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
          { path: "/scopes/:name", module: ScopeDesigner },
          { path: "/api", module: Api },
          { path: "/settings", module: Config },
        ],
      },
    ],
  },
] satisfies AppRoutes;
