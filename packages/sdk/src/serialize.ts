import { Column, Owned, Reference, resolveRefTargetColumns, type RefTargetRaw, type ShapeRecord } from "../../core/src/index.js";

// json → obj: a API devolve datas como string ISO. Aqui revivemos pra `Date`,
// dirigidos pela FORMA da entidade (mesma ideia do read do engine): colunas de
// tipo Date, owned aninhado (recursivo), e references expandidas (um nível, via
// a forma do alvo). Os timestamps managed (createdAt/updatedAt) sempre viram Date.
//
// (Write não precisa de tratamento: JSON.stringify já serializa Date → ISO, e a
// reference vai por `<campo>Id`, que é string.)
export function reviveShape(shape: ShapeRecord, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;

  for (const [key, node] of Object.entries(shape)) {
    const v = obj[key];
    if (node instanceof Column) {
      if (node.config.pgType.tsLabel === "Date" && typeof v === "string") {
        obj[key] = new Date(v);
      }
    } else if (node instanceof Owned) {
      if (Array.isArray(v)) v.forEach((x) => reviveShape(node.shape, x));
      else if (v) reviveShape(node.shape, v);
    } else if (node instanceof Reference) {
      // Só age se a reference veio EXPANDIDA (objeto/array); id-form é string, ignora.
      // Resolve thunk/self: no client a reference pode não estar resolvida (`self()` →
      // a forma corrente; `() => other` → chama o thunk).
      const cols = resolveRefTargetColumns(node.target as unknown as RefTargetRaw, shape);
      if (node.cardinality === "many" && Array.isArray(v)) {
        v.forEach((x) => reviveShape(cols, x));
      } else if (v && typeof v === "object") {
        reviveShape(cols, v);
      }
    }
  }

  if (typeof obj["createdAt"] === "string") obj["createdAt"] = new Date(obj["createdAt"]);
  if (typeof obj["updatedAt"] === "string") obj["updatedAt"] = new Date(obj["updatedAt"]);
  return obj;
}
