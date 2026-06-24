import type { ActionArgs } from "@mauroandre/velojs";
import type { ComponentChildren } from "preact";
import { Link } from "@mauroandre/velojs";
import * as css from "./AdminLayout.css.js";

export const action_logout = async ({ c }: ActionArgs) => {
  const { deleteCookie } = await import("@mauroandre/velojs/cookie");
  deleteCookie(c!, "session", { path: "/" });
  return { ok: true };
};

const NAV = [
  { to: "~/", label: "Início" },
  { to: "~/dados", label: "Dados" },
  { to: "~/entidades", label: "Entidades" },
  { to: "~/scopes", label: "Scopes" },
  { to: "~/api", label: "API" },
  { to: "~/config", label: "Config" },
];

export const Component = ({ children }: { children?: ComponentChildren }) => (
  <div class={css.shell}>
    <nav class={css.sidebar}>
      <strong class={css.brand}>Weave</strong>
      <ul class={css.navList}>
        {NAV.map((item) => (
          <li key={item.to}>
            <Link to={item.to}>{item.label}</Link>
          </li>
        ))}
      </ul>
      <button
        class={css.logout}
        onClick={async () => {
          await action_logout({ body: {} });
          window.location.href = "/login";
        }}
      >
        Sair
      </button>
    </nav>
    <main class={css.content}>{children}</main>
  </div>
);
