import type { ActionArgs } from "@mauroandre/velojs";
import type { ComponentChildren } from "preact";
import { Link } from "@mauroandre/velojs";
import { usePathname } from "@mauroandre/velojs/hooks";
import {
  HomeAngle,
  Database,
  Box,
  ShieldKeyhole,
  Code,
  Settings,
  Logout,
} from "../components/solar-linear-icons.js";
import * as css from "./AdminLayout.css.js";

export const action_logout = async ({ c }: ActionArgs) => {
  const { deleteCookie } = await import("@mauroandre/velojs/cookie");
  deleteCookie(c!, "session", { path: "/" });
  return { ok: true };
};

const NAV = [
  { to: "/", label: "Início", Icon: HomeAngle },
  { to: "/dados", label: "Dados", Icon: Database },
  { to: "/entidades", label: "Entidades", Icon: Box },
  { to: "/scopes", label: "Scopes", Icon: ShieldKeyhole },
  { to: "/api", label: "API", Icon: Code },
  { to: "/config", label: "Config", Icon: Settings },
];

export const Component = ({ children }: { children?: ComponentChildren }) => {
  const path = usePathname();
  return (
    <div class={css.shell}>
      <aside class={css.sidebar}>
        <div class={css.brand}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 7c5 0 7 10 16 10" stroke="#2F6FEB" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M4 17c5 0 7-10 16-10" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span>Weave</span>
        </div>

        <nav class={css.nav}>
          {NAV.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={`~${to}`}
              class={path === to ? `${css.navLink} ${css.navLinkActive}` : css.navLink}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <button
          class={css.logout}
          onClick={async () => {
            await action_logout({ body: {} });
            window.location.href = "/login";
          }}
        >
          <Logout size={18} />
          <span>Sair</span>
        </button>
      </aside>

      <main class={css.content}>{children}</main>
    </div>
  );
};
