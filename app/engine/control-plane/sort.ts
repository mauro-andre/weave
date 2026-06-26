// Compilador de ordenação. Monta o `ORDER BY` a partir de chaves (caminho +
// direção). Topo → `root.col`; galho SINGLE (reference N:1, owned 1:1) → subquery
// correlacionada que projeta o valor. Lista não é ordenável (ambíguo). Campos
// gerenciados (created at / updated at / id) são chaves válidas em qualquer nível.

import { camelToSnake, ownedChildTable, ownedFkColumn } from "@mauroandre/weave-core";
import { singularize } from "@mauroandre/weave-core";
import { slug } from "@mauroandre/weave-core";
import type { EntityIR, FieldIR } from "@mauroandre/weave-core";

export interface SortKey {
  path: string[];
  dir: "asc" | "desc";
}

const MANAGED: Record<string, string> = { createdAt: "created_at", updatedAt: "updated_at", id: "id" };

/** Compila as chaves no trecho do `ORDER BY` (sem o "ORDER BY"; sem params). */
export function compileSort(
  rootName: string,
  rootFields: Record<string, FieldIR>,
  byName: Map<string, EntityIR>,
  sort: SortKey[],
): string {
  let aliasN = 0;
  const alias = () => `s${++aliasN}`;
  const rootPrefix = singularize(slug(rootName));

  return sort
    .map((key) => {
      const expr = valueExpr(rootFields, "root", rootPrefix, key.path);
      return `${expr} ${key.dir === "desc" ? "DESC" : "ASC"}`;
    })
    .join(", ");

  function valueExpr(
    fields: Record<string, FieldIR>,
    parent: string,
    prefix: string,
    segs: string[],
  ): string {
    const [head, ...rest] = segs;
    if (head === undefined) throw new Error("sort: empty path.");
    const node = fields[head];

    if (rest.length === 0) {
      if (node?.kind === "column") {
        if (node.array) throw new Error(`sort: can't sort by a list column ('${head}').`);
        return `${parent}.${camelToSnake(head)}`;
      }
      if (!node && MANAGED[head]) return `${parent}.${MANAGED[head]}`;
      throw new Error(`sort: '${head}' is not a sortable field.`);
    }

    if (!node) throw new Error(`sort: unknown field '${head}'.`);
    if (node.kind === "owned") {
      if (node.array) throw new Error(`sort: can't sort through a collection ('${head}').`);
      const child = ownedChildTable(prefix, camelToSnake(head), node.table);
      const a = alias();
      return `(SELECT ${valueExpr(node.shape ?? {}, a, child, rest)} FROM ${child} ${a} WHERE ${a}.${ownedFkColumn(prefix)} = ${parent}.id LIMIT 1)`;
    }
    if (node.kind === "reference") {
      if (node.cardinality !== "one") throw new Error(`sort: can't sort through a link list ('${head}').`);
      const target = byName.get(node.target);
      if (!target) throw new Error(`sort: unknown reference target '${node.target}'.`);
      const a = alias();
      return `(SELECT ${valueExpr(target.fields, a, singularize(slug(node.target)), rest)} FROM ${slug(node.target)} ${a} WHERE ${a}.id = ${parent}.${camelToSnake(head)}_id)`;
    }
    throw new Error(`sort: '${head}' can't be traversed.`);
  }
}
