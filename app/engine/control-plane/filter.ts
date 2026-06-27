// Formato de ARMAZENAMENTO do filtro de linhas de um scope: uma árvore booleana
// de condições por CAMINHO (de field-ids — rename-proof). NÃO é a linguagem de
// query do sistema (essa é o `WhereInput` do core); é só a planta guardada do
// scope, convertida pra `WhereInput` na imposição (ver `scope.ts → resolveFilter`).
// O ScopeDesigner produz/consome este formato.

/** Uma folha do filtro: um caminho até um escalar + operador + valor. */
export interface Condition {
  /** Segmentos do caminho — por field-id no storage, por nome após resolver. */
  path: string[];
  /** Operador (contains, equals, gt, isEmpty, isTrue, on, …). */
  op: string;
  /** Valor procurado (ou `{ param }` no storage; ausente em isEmpty/isTrue/isFalse). */
  value?: unknown;
}

/** Árvore booleana: combina sub-nós com AND (`and`) ou OR (`or`), recursivo. */
export type Filter = Condition | { and: Filter[] } | { or: Filter[] };
