import type { ActionArgs, LoaderArgs } from "@mauroandre/velojs";
import { Link } from "@mauroandre/velojs";
import { useLoader } from "@mauroandre/velojs/hooks";
import type { EntityIR } from "../engine/ir/types.js";
import * as css from "./Entities.css.js";

export const loader = async (_args: LoaderArgs) => {
  const { listEntities } = await import("../engine/control-plane/entities.js");
  return await listEntities();
};

export const action_saveEntity = async ({ body }: ActionArgs<{ ir: unknown }>) => {
  const { saveEntity } = await import("../engine/control-plane/entities.js");
  try {
    const ir = await saveEntity(body.ir);
    return { ok: true, name: ir.name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save entity." };
  }
};

export const Component = () => {
  const { data } = useLoader<EntityIR[]>();
  const entities = data.value ?? [];
  return (
    <div>
      <header class={css.header}>
        <h1 class={css.title}>Entities</h1>
        <Link to="~/entities/new" class={css.newBtn}>
          + New entity
        </Link>
      </header>
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
    </div>
  );
};
