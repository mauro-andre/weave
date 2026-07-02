import type {
  Entity,
  ShapeRecord,
  InferEntity,
  InferInsert,
  WhereInput,
  OrderByInput,
} from "../../core/src/index.js";

// Aliases de nível-SDK, voltados pro dev — pra nomear tipos em FRONTEIRAS de função
// (helpers de service tipo `getUser(where)`, `updateUser(where, patch)`). No fluxo
// normal nem são necessários: find/create/update se auto-tipam pelo entities-as-code.

/** O objeto como ele VOLTA da leitura (sem expand). `Infer<typeof product>`. */
export type Infer<E extends Entity<string, ShapeRecord>> = InferEntity<E>;

/** O filtro do 1º argumento (find/update/delete). `InferWhere<typeof product>`. */
export type InferWhere<E extends Entity<string, ShapeRecord>> = WhereInput<E>;

/** O patch de `updateOne`/`updateMany` — `InferInsert` com tudo opcional. `InferPatch<typeof product>`. */
export type InferPatch<E extends Entity<string, ShapeRecord>> = Partial<InferInsert<E>>;

/** A ordenação (`opts.orderBy`). `InferOrderBy<typeof product>`. */
export type InferOrderBy<E extends Entity<string, ShapeRecord>> = OrderByInput<E>;

/** @deprecated nome antigo de {@link InferPatch}. */
export type InferUpdate<E extends Entity<string, ShapeRecord>> = InferPatch<E>;
