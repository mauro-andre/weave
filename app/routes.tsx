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
import * as Admin from "./api/admin.js";
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
      // Aninhada sob /api — a key é validada uma vez no nó pai.
      {
        path: "/api",
        middlewares: [apiKeyMiddleware],
        children: [
          { path: "/:entity", method: "GET", handler: DataApi.apiList },
          { path: "/:entity", method: "POST", handler: DataApi.apiCreate },
          { path: "/:entity", method: "PATCH", handler: DataApi.apiUpdate },
          { path: "/:entity", method: "DELETE", handler: DataApi.apiDelete },
          { path: "/:entity/aggregate", method: "POST", handler: DataApi.apiAggregate },
          { path: "/:entity/accumulate", method: "POST", handler: DataApi.apiAccumulate },
          { path: "/:entity/:id", method: "GET", handler: DataApi.apiGetOne },
        ],
      },
      // API de admin (control-plane): entidades (plan/apply) + scopes. Mesma key.
      {
        path: "/admin",
        middlewares: [apiKeyMiddleware],
        children: [
          { path: "/reset", method: "POST", handler: Admin.adminReset },
          { path: "/push", method: "POST", handler: Admin.adminPush },
          { path: "/pending", method: "GET", handler: Admin.adminGetPending },
          { path: "/entities", method: "GET", handler: Admin.adminListEntities },
          { path: "/entities/:name", method: "GET", handler: Admin.adminGetEntity },
          { path: "/entities/:name", method: "PUT", handler: Admin.adminPutEntity },
          { path: "/entities/:name", method: "DELETE", handler: Admin.adminDeleteEntity },
          { path: "/scopes", method: "GET", handler: Admin.adminListScopes },
          { path: "/scopes/:name", method: "GET", handler: Admin.adminGetScope },
          { path: "/scopes/:name", method: "PUT", handler: Admin.adminPutScope },
          { path: "/scopes/:name", method: "DELETE", handler: Admin.adminDeleteScope },
        ],
      },
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
