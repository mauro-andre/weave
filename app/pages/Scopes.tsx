import type { LoaderArgs } from "@mauroandre/velojs";
import { Link } from "@mauroandre/velojs";
import { useLoader } from "@mauroandre/velojs/hooks";
import { Page } from "../components/Page.js";
import { camelize } from "@mauroandre/weave-core";
import * as btn from "../styles/button.css.js";
import * as css from "./Scopes.css.js";

interface ScopeSummary {
  name: string;
  entities: string[];
}

export const loader = async (_args: LoaderArgs): Promise<ScopeSummary[]> => {
  const { listScopes } = await import("../engine/control-plane/scopes.js");
  return (await listScopes()).map((s) => ({ name: s.name, entities: Object.keys(s.entities) }));
};

export const Component = () => {
  const { data } = useLoader<ScopeSummary[]>();
  const scopes = data.value ?? [];

  return (
    <Page
      title="Scopes"
      actions={
        <Link to="~/scopes/new" class={btn.primary}>
          + New scope
        </Link>
      }
    >
      {scopes.length === 0 ? (
        <p class={css.empty}>No scopes yet. A scope shapes what an API request can read, write, and see.</p>
      ) : (
        <div class={css.list}>
          {scopes.map((s) => (
            <Link key={s.name} to={`~/scopes/${s.name}`} class={css.item}>
              <span class={css.name}>{s.name}</span>
              <span class={css.meta}>{s.entities.map(camelize).join(" · ") || "no entities"}</span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
};
