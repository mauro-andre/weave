import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import { Link } from "@mauroandre/velojs";
import { useLoader } from "@mauroandre/velojs/hooks";
import { Page } from "../components/Page.js";
import type { EntityIR } from "../engine/ir/types.js";
import * as btn from "../styles/button.css.js";
import * as css from "./Entities.css.js";

export const loader = async (_args: LoaderArgs) => {
  const { listEntities } = await import("../engine/control-plane/entities.js");
  return await listEntities();
};

export const action_saveEntity = async ({
  body,
}: ActionArgs<{ ir: unknown; confirm?: string[]; fill?: Record<string, unknown> }>) => {
  const { applyEntity } = await import("../engine/control-plane/entities.js");
  try {
    const out = await applyEntity(body.ir, {
      ...(body.confirm ? { confirm: body.confirm } : {}),
      ...(body.fill ? { fill: body.fill } : {}),
    });
    return { ok: true, status: out.status, name: out.name, plan: out.plan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save entity." };
  }
};

// Dry-run: devolve o plano de mudanças (diff por id) sem aplicar nada.
export const action_planEntity = async ({ body }: ActionArgs<{ ir: unknown }>) => {
  const { planEntity } = await import("../engine/control-plane/entities.js");
  try {
    return { ok: true, plan: await planEntity(body.ir) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to plan entity." };
  }
};

export const Component = () => {
  const { data } = useLoader<EntityIR[]>();
  const entities = data.value ?? [];
  return (
    <Page
      title="Entities"
      actions={
        <Link to="~/entities/new" class={btn.primary}>
          + New entity
        </Link>
      }
    >
      {entities.length === 0 ? (
        <p class={css.empty}>No entities yet. Create the first one.</p>
      ) : (
        <div class={css.list}>
          {entities.map((e) => (
            <Link key={e.name} to={`~/entities/${e.name}`} class={css.item}>
              {e.name}
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
};
