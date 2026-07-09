/**
 * `reference` relationship — association (Phases 3 & 4).
 *
 * The target is an **independent** entity (its own table), possibly shared by
 * many. This side only **points and reads**: it never writes the target table.
 *
 *   - `reference(city)`         → N:1. FK column `city_id` (no cascade).
 *                                 Reads `cityId` always, `city` on expand.
 *   - `reference(array(city))`  → N:N. A join table (`user_cities`), composite
 *                                 PK, both FKs cascade the *link*. Reads nothing
 *                                 by default; `cities: City[]` on expand. Writes
 *                                 via `citiesIds: string[]` (replaces the set).
 */

import type { Entity, ShapeRecord } from "./entity.js";

export type ReferenceCardinality = "one" | "many";

type AnyEntity = Entity<string, ShapeRecord>;

/**
 * Marcador de auto-referência: `reference(self())` / `reference(array(self()))`.
 * NÃO carrega a entity por valor — o alvo é resolvido pro nome da PRÓPRIA entity no
 * `toIR`. Isso destrava o self-ref sem o muro de inferência de `const` (o thunk
 * `() => users` referenciaria `users` no próprio initializer; o `self()` não).
 */
export class SelfMarker {
  readonly kind = "self" as const;
}

/** Alvo de uma reference em runtime: entity eager, thunk lazy (ciclo/self), ou `self()`. */
export type RefTargetRaw = AnyEntity | (() => AnyEntity) | SelfMarker;

/** Resolve o alvo cru pro NOME da entity-alvo, dado o nome da entity que o contém. */
export function resolveRefTargetName(target: RefTargetRaw, selfName: string): string {
  if (target instanceof SelfMarker) return selfName;
  if (typeof target === "function") return target().name;
  return target.name;
}

/**
 * Resolve o alvo cru pra FORMA (columns) da entity-alvo. Usado no revive do client
 * (`serialize.ts`), que caminha references NÃO resolvidas. `selfColumns` = a forma
 * corrente (o `self()` aponta pra própria entity → mesma forma que está sendo lida).
 */
export function resolveRefTargetColumns(target: RefTargetRaw, selfColumns: ShapeRecord): ShapeRecord {
  if (target instanceof SelfMarker) return selfColumns;
  if (typeof target === "function") return target().columns;
  return target.columns;
}

export class Reference<
  TTarget extends Entity<string, ShapeRecord> = Entity<string, ShapeRecord>,
  TCard extends ReferenceCardinality = "one",
  TNotNull extends boolean = false,
> {
  readonly kind = "reference" as const;
  /** Phantom carrier so the compiler can recover target/cardinality/nullability. */
  declare readonly _phantom: { target: TTarget; cardinality: TCard; notNull: TNotNull };

  constructor(
    /**
     * Alvo. TIPADO como entity (os consumidores do engine leem `.target.name/.columns`
     * pós-`fromIR`, onde é sempre entity real). Em RUNTIME, no caminho de definição do
     * client, pode carregar thunk/`self()` cru — resolvido só no `toIR`/revive. Nunca
     * chega ao engine cru (vira nome no IR).
     */
    readonly target: TTarget,
    readonly cardinality: TCard,
    readonly isNotNull: boolean,
    /** Stable field id (UUID) — survives rename. Normally emitted by `weave gen`. */
    readonly id?: string,
  ) {}

  /** Nome da entity-alvo, resolvendo thunk/self (`selfName` = nome de quem contém). */
  targetName(selfName: string): string {
    return resolveRefTargetName(this.target as unknown as RefTargetRaw, selfName);
  }

  /** Make the FK `NOT NULL` (only meaningful for N:1). */
  notNull(): Reference<TTarget, TCard, true> {
    return new Reference<TTarget, TCard, true>(this.target, this.cardinality, true, this.id);
  }

  /** Pin a stable field id (survives rename). Normally emitted by `weave gen`. */
  $id(id: string): Reference<TTarget, TCard, TNotNull> {
    return new Reference<TTarget, TCard, TNotNull>(this.target, this.cardinality, this.isNotNull, id);
  }
}

/** A reference of any target/cardinality/nullability. */
export type AnyReference = Reference<Entity<string, ShapeRecord>, ReferenceCardinality, boolean>;

/** Marker produced by `array(entity)` / `array(() => entity)` / `array(self())` — N:N. */
export class ReferenceArray<TTarget extends Entity<string, ShapeRecord>> {
  readonly kind = "reference_array" as const;
  constructor(readonly target: RefTargetRaw) {}
}

/** `self()` — alvo = a própria entity. Para self-ref (`reference(self())` ou N:N). */
export function self(): SelfMarker {
  return new SelfMarker();
}

/** Declare an N:1 reference to an independent entity (nullable by default). */
export function reference<T extends Entity<string, ShapeRecord>>(
  target: T,
): Reference<T, "one", false>;
/**
 * N:1 lazy (thunk) — para ciclo mútuo entre entities: `reference(() => users)`.
 * Alvo FROUXO de propósito: capturar `typeof users` no phantom criaria um ciclo de
 * inferência de `const` (typeof company ↔ typeof users) que colapsa o TShape inteiro.
 * O `expand` desse campo vem frouxo (o FK id e as colunas irmãs continuam precisos).
 * Refs ACÍCLICOS usam o overload eager (`reference(x)`), que mantém o expand tipado.
 */
export function reference(thunk: () => Entity<string, ShapeRecord>): Reference<Entity<string, ShapeRecord>, "one", false>;
/** N:1 self-ref: `reference(self())`. Alvo frouxo (a própria entity). */
export function reference(marker: SelfMarker): Reference<Entity<string, ShapeRecord>, "one", false>;
/** Declare an N:N reference (from `array(entity)` / `array(() => entity)` / `array(self())`). */
export function reference<T extends Entity<string, ShapeRecord>>(
  set: ReferenceArray<T>,
): Reference<T, "many", false>;
export function reference(
  arg: RefTargetRaw | ReferenceArray<Entity<string, ShapeRecord>>,
): Reference<Entity<string, ShapeRecord>, ReferenceCardinality, false> {
  // O alvo cru (entity/thunk/self) é guardado como está; `.target` é tipado como entity
  // (ver o construtor) — cast aqui, resolução real no `toIR`/revive.
  if (arg instanceof ReferenceArray) {
    return new Reference(arg.target as AnyEntity, "many", false);
  }
  return new Reference(arg as AnyEntity, "one", false);
}
