import type { Entity, ShapeRecord, InferEntity, InferInsert } from "@mauroandre/weave-core";

// Aliases de nível-SDK, voltados pro dev (nomear tipos em fronteiras de função).
// No fluxo normal nem são necessários — find/create se auto-tipam.

/** O objeto como ele VOLTA da leitura (sem expand). `Infer<typeof product>`. */
export type Infer<E extends Entity<string, ShapeRecord>> = InferEntity<E>;

/** O patch aceito por `update` — `InferInsert` com tudo opcional. */
export type InferUpdate<E extends Entity<string, ShapeRecord>> = Partial<InferInsert<E>>;
