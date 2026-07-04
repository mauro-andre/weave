import type { ActionArgs } from "@mauroandre/velojs";
import type { ComponentChildren } from "preact";
import { Link } from "@mauroandre/velojs";
import { usePathname, useLoader } from "@mauroandre/velojs/hooks";
import type { Pending } from "../components/PendingBanner.js";
import {
  HomeAngle,
  Database,
  Box,
  ShieldKeyhole,
  Code,
  Settings,
  Logout,
} from "../components/solar-linear-icons.js";
import { PendingBanner } from "../components/PendingBanner.js";
import * as css from "./AdminLayout.css.js";

export const action_logout = async ({ c }: ActionArgs) => {
  const { deleteCookie } = await import("@mauroandre/velojs/cookie");
  deleteCookie(c!, "session", { path: "/" });
  return { ok: true };
};

// Loader do layout: lê o pending server-side pra a faixa RENDERIZAR na carga (action é
// ativa/POST, não aparece sozinha — por isso o pending vem daqui).
export const loader = async (): Promise<{ pending: Pending | null }> => {
  const { getPending } = await import("../engine/control-plane/pending.js");
  return { pending: (await getPending()) as Pending | null };
};

// Resolver é uma action (POST): aplica confirm/fill via applyProject e devolve o NOVO
// pending (null se convergiu). A faixa atualiza o signal com isso — sem reload de tela.
export const action_resolvePending = async ({
  body,
}: ActionArgs<{ confirm?: Record<string, string[]>; fill?: Record<string, Record<string, unknown>> }>): Promise<{
  pending: Pending | null;
}> => {
  const { getPending } = await import("../engine/control-plane/pending.js");
  const { applyProject } = await import("../engine/control-plane/entities.js");
  const pending = await getPending();
  if (!pending) return { pending: null };
  await applyProject(
    pending.entries.map((e) => e.ir),
    { ...(body.confirm ? { confirm: body.confirm } : {}), ...(body.fill ? { fill: body.fill } : {}), source: "gui" },
  );
  return { pending: (await getPending()) as Pending | null }; // o estado depois (null = convergiu)
};

const NAV = [
  { to: "/", label: "Home", Icon: HomeAngle },
  { to: "/data", label: "Data", Icon: Database },
  { to: "/entities", label: "Entities", Icon: Box },
  { to: "/scopes", label: "Scopes", Icon: ShieldKeyhole },
  { to: "/api", label: "API", Icon: Code },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export const Component = ({ children }: { children?: ComponentChildren }) => {
  const path = usePathname();
  const { data } = useLoader<{ pending: Pending | null }>();
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
          <span>Sign out</span>
        </button>
      </aside>

      <main class={css.content}>
        <PendingBanner initial={data.value?.pending ?? null} resolve={action_resolvePending} />
        {children}
      </main>
    </div>
  );
};
