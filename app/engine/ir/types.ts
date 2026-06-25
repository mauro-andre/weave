// Formato do IR (§4.5 do PRD-PLATFORM): espelho serializável do que o
// `defineEntity` expressa. É a fonte da verdade da planta, guardada em jsonb.

export interface ColumnIR {
  kind: "column";
  /** Nome do catálogo (`"text"`, `"int4"`, …). */
  type: string;
  array?: boolean;
  notNull?: boolean;
  default?: unknown;
  unique?: boolean;
  index?: boolean;
}

export interface ReferenceIR {
  kind: "reference";
  /** Nome da entidade alvo. */
  target: string;
  cardinality: "one" | "many";
  notNull?: boolean;
}

export interface OwnedIR {
  kind: "owned";
  /** `false` = 1:1, `true` = 1:N. */
  array: boolean;
  /** Forma inline (XOR com `mirror`). */
  shape?: Record<string, FieldIR>;
  /** Espelha a forma de outra entidade (XOR com `shape`). Resolvido no sync. */
  mirror?: string;
  /** Override do nome da tabela filha. */
  table?: string;
}

export type FieldIR = ColumnIR | ReferenceIR | OwnedIR;

export interface EntityIR {
  irVersion: number;
  name: string;
  fields: Record<string, FieldIR>;
}
