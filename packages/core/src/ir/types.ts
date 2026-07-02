// Formato do IR (§4.5 do PRD-PLATFORM): espelho serializável do que o
// `defineEntity` expressa. É a fonte da verdade da planta, guardada em jsonb.

export interface ColumnIR {
  kind: "column";
  /** Identidade estável do campo (UUID), garantida no back. Sobrevive a rename. */
  id?: string;
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
  /** Identidade estável do campo (UUID), garantida no back. Sobrevive a rename. */
  id?: string;
  /** Nome da entidade alvo. */
  target: string;
  cardinality: "one" | "many";
  notNull?: boolean;
}

export interface OwnedIR {
  kind: "owned";
  /** Identidade estável do campo (UUID), garantida no back. Sobrevive a rename. */
  id?: string;
  /** `false` = 1:1, `true` = 1:N. */
  array: boolean;
  /**
   * Forma do owned. Sem `mirror`: é a forma inline completa. Com `mirror`: são os
   * **campos locais** (extras), anexados à forma espelhada (ex.: `quantidade` num
   * item de pedido que espelha `produto`).
   */
  shape?: Record<string, FieldIR>;
  /** Espelha a forma de outra entidade. Resolvido no sync; pode coexistir com `shape` (locais). */
  mirror?: string;
  /** Override do nome da tabela filha. */
  table?: string;
}

export type FieldIR = ColumnIR | ReferenceIR | OwnedIR;

export interface EntityIR {
  irVersion: number;
  name: string;
  fields: Record<string, FieldIR>;
  /** Grupos de UNIQUE composto (nomes lógicos de campo). Ver `EntityOptions`. */
  unique?: string[][];
  /** Grupos de índice composto (não-único). */
  index?: string[][];
  /** Partição RANGE por tempo: `field` (nome lógico) + `interval` (ex.: "1d"). */
  partitionBy?: { field: string; interval: string };
  /** Retenção da partição (ex.: "30d") — dropa partições cujo topo já passou. */
  retention?: string;
}
