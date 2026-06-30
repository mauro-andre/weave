import { useLoader, usePathname } from "@mauroandre/velojs/hooks";
import type { LoaderArgs } from "@mauroandre/velojs";
import { Link } from "@mauroandre/velojs";
import { useSignal } from "@preact/signals";
import { Mark } from "../components/Mark.js";
import * as css from "./Layout.css.js";

interface DocEntry {
  slug: string;
  title: string;
  order: number;
  filename: string;
}

export const loader = async ({}: LoaderArgs) => {
  const { default: manifest } = await import("virtual:docs-manifest");
  return { manifest: manifest as DocEntry[] };
};

export const Component = ({ children }: { children: any }) => {
  const sidebarOpen = useSignal(false);
  const pathname = usePathname();
  const { data } = useLoader<{ manifest: DocEntry[] }>([pathname]);

  const entries = data.value?.manifest ?? [];

  return (
    <div class={css.layout}>
      <button class={css.mobileToggle} onClick={() => (sidebarOpen.value = !sidebarOpen.value)}>
        {sidebarOpen.value ? "✕" : "☰"}
      </button>

      <aside class={`${css.sidebar} ${sidebarOpen.value ? css.sidebarVisible : ""}`}>
        <div class={css.sidebarHeader}>
          <Link to="~/" class={css.sidebarLogo}>
            <Mark size={22} />
            <span>Weave</span>
          </Link>
        </div>

        <nav class={css.sidebarNav}>
          {entries.map((entry) => (
            <Link
              key={entry.slug}
              to={`~/docs/${entry.slug}`}
              class={`${css.sidebarLink} ${pathname === `/docs/${entry.slug}` ? css.sidebarLinkActive : ""}`}
            >
              {entry.title}
            </Link>
          ))}
        </nav>
      </aside>

      <main class={css.content}>{children}</main>
    </div>
  );
};
