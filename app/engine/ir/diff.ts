// Diff de intenção entre dois IRs (anterior ↔ novo), casando campos por `id`.
// É aqui que rename deixa de ser "remove+add": mesmo id, nome novo = rename.
// Produz um plano de mudanças classificado por risco — sem tocar no banco. As
// classificações dependentes de dado (vazios, duplicatas, conversão) saem no
// pior caso e são refinadas no estágio de aplicação (sondagem do banco vivo).

import type { ColumnIR, EntityIR, FieldIR } from "./types.js";

export type ChangeRisk =
  | "auto" // 🟢 aplica sozinho
  | "confirm" // 🔴 apaga dado — pede confirmação
  | "needsValue" // 🟡 precisa de um valor (backfill uniforme)
  | "blocked"; // ⛔ corrige por fora (browser)

export type ChangeOp =
  | "addField"
  | "removeField"
  | "renameField"
  | "retypeField"
  | "makeRequired"
  | "dropRequired"
  | "addUnique"
  | "dropUnique"
  | "addIndex"
  | "dropIndex"
  | "changeDefault"
  | "reshape";

export interface FieldChange {
  risk: ChangeRisk;
  op: ChangeOp;
  /** Caminho do campo (com `.` para owned aninhado), pelo nome NOVO. */
  path: string;
  /** Para `renameField`: o nome ANTIGO (origem do rename). */
  from?: string;
  /** Resumo em linguagem de objeto (a UI pode reusar ou recompor). */
  title: string;
  detail: string;
  /** Para `needsValue`: tipo do catálogo, pra renderizar o input de backfill. */
  fillType?: string;
}

export interface EntityDiff {
  entity: string;
  /** Entidade nova (sem IR anterior): criação pura, nada a revisar. */
  isNew: boolean;
  changes: FieldChange[];
}

export function diffEntityIR(prev: EntityIR | null, next: EntityIR): EntityDiff {
  if (!prev) return { entity: next.name, isNew: true, changes: [] };
  const changes: FieldChange[] = [];
  diffShape(prev.fields, next.fields, "", changes);
  return { entity: next.name, isNew: false, changes };
}

function diffShape(
  prev: Record<string, FieldIR>,
  next: Record<string, FieldIR>,
  prefix: string,
  changes: FieldChange[],
): void {
  const prevById = byId(prev);
  const consumed = new Set<string>();

  for (const [name, node] of Object.entries(next)) {
    const path = join(prefix, name);
    const match = node.id ? prevById.get(node.id) : undefined;
    if (!match) {
      changes.push(...added(node, path));
      continue;
    }
    consumed.add(node.id!);
    diffNode(match.name, match.node, name, node, prefix, changes);
  }

  for (const [id, { name, node }] of prevById) {
    if (consumed.has(id)) continue;
    changes.push(removed(node, join(prefix, name)));
  }
}

function diffNode(
  prevName: string,
  prevNode: FieldIR,
  nextName: string,
  nextNode: FieldIR,
  prefix: string,
  changes: FieldChange[],
): void {
  const path = join(prefix, nextName);

  if (prevName !== nextName) {
    changes.push({
      risk: "auto",
      op: "renameField",
      path,
      from: prevName,
      title: `Rename ${prevName} → ${nextName}`,
      detail: "Data is kept.",
    });
  }

  if (prevNode.kind !== nextNode.kind) {
    changes.push({
      risk: "blocked",
      op: "reshape",
      path,
      title: `Change the shape of ${nextName}`,
      detail: "Switching a field between primitive, object and reference isn't supported yet.",
    });
    return;
  }

  if (prevNode.kind === "column" && nextNode.kind === "column") {
    diffColumn(prevNode, nextNode, path, nextName, changes);
    return;
  }
  if (prevNode.kind === "owned" && nextNode.kind === "owned") {
    if ((prevNode.mirror ?? "") !== (nextNode.mirror ?? "")) {
      changes.push({
        risk: "blocked",
        op: "reshape",
        path,
        title: `Re-link ${nextName}`,
        detail: "Changing which entity an object mirrors isn't supported yet.",
      });
    }
    diffShape(prevNode.shape ?? {}, nextNode.shape ?? {}, path, changes);
    return;
  }
  if (prevNode.kind === "reference" && nextNode.kind === "reference") {
    if (prevNode.target !== nextNode.target || prevNode.cardinality !== nextNode.cardinality) {
      changes.push({
        risk: "blocked",
        op: "reshape",
        path,
        title: `Change the reference ${nextName}`,
        detail: "Changing a reference's target or cardinality isn't supported yet.",
      });
    }
  }
}

function diffColumn(
  prev: ColumnIR,
  next: ColumnIR,
  path: string,
  name: string,
  changes: FieldChange[],
): void {
  if (prev.type !== next.type || (prev.array ?? false) !== (next.array ?? false)) {
    changes.push({
      risk: "blocked",
      op: "retypeField",
      path,
      title: `Change ${name}: ${typeLabel(prev)} → ${typeLabel(next)}`,
      detail: "Existing values must convert; rows that can't will block the change.",
    });
  }

  const wasReq = prev.notNull ?? false;
  const isReq = next.notNull ?? false;
  if (!wasReq && isReq) {
    changes.push({
      risk: "needsValue",
      op: "makeRequired",
      path,
      title: `Make ${name} required`,
      detail: "Empty records need a value.",
      fillType: next.type,
    });
  } else if (wasReq && !isReq) {
    changes.push({ risk: "auto", op: "dropRequired", path, title: `Make ${name} optional`, detail: "" });
  }

  const wasUq = prev.unique ?? false;
  const isUq = next.unique ?? false;
  if (!wasUq && isUq) {
    changes.push({
      risk: "blocked",
      op: "addUnique",
      path,
      title: `Make ${name} unique`,
      detail: "Duplicate values would block this; resolve them in the data first.",
    });
  } else if (wasUq && !isUq) {
    changes.push({ risk: "auto", op: "dropUnique", path, title: `Drop unique on ${name}`, detail: "" });
  }

  const wasIdx = prev.index ?? false;
  const isIdx = next.index ?? false;
  if (!wasIdx && isIdx) {
    changes.push({ risk: "auto", op: "addIndex", path, title: `Index ${name}`, detail: "" });
  } else if (wasIdx && !isIdx) {
    changes.push({ risk: "auto", op: "dropIndex", path, title: `Drop index on ${name}`, detail: "" });
  }

  if (!sameDefault(prev.default, next.default)) {
    changes.push({ risk: "auto", op: "changeDefault", path, title: `Change default of ${name}`, detail: "" });
  }
}

function added(node: FieldIR, path: string): FieldChange[] {
  if (node.kind === "column" && (node.notNull ?? false) && node.default === undefined) {
    return [
      {
        risk: "needsValue",
        op: "addField",
        path,
        title: `Add required field ${path}`,
        detail: "Existing records need a value.",
        fillType: node.type,
      },
    ];
  }
  const what = node.kind === "owned" ? (node.array ? "list" : "object") : node.kind === "reference" ? "reference" : "field";
  return [{ risk: "auto", op: "addField", path, title: `Add ${what} ${path}`, detail: "" }];
}

function removed(node: FieldIR, path: string): FieldChange {
  if (node.kind === "owned") {
    return {
      risk: "confirm",
      op: "removeField",
      path,
      title: `Remove ${node.array ? "list" : "object"} ${path}`,
      detail: "Deletes all its records permanently.",
    };
  }
  return {
    risk: "confirm",
    op: "removeField",
    path,
    title: `Remove field ${path}`,
    detail: "Deletes its data permanently.",
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────
function byId(fields: Record<string, FieldIR>): Map<string, { name: string; node: FieldIR }> {
  const m = new Map<string, { name: string; node: FieldIR }>();
  for (const [name, node] of Object.entries(fields)) if (node.id) m.set(node.id, { name, node });
  return m;
}

function join(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function typeLabel(c: ColumnIR): string {
  return c.array ? `${c.type}[]` : c.type;
}

function sameDefault(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
