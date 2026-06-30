import type { EntityIR, FieldIR } from "@mauroandre/weave-core";
import { errorFor } from "./errors.js";
import type { FetchLike } from "./client.js";

// Codegen: IR (remoto) → source `defineEntity` (`weave pull`), e o barrel do client
// (`weave gen`). Inverso do `toIR`. Puro (sem fs) — o CLI escreve em disco.

interface GenCtx {
  builders: Set<string>; // construtores/helpers usados (text, owned, reference, array…)
  imports: Set<string>; // entidades-alvo de reference (pra importar)
  mirror: boolean; // owned com mirror — o builder não tem `mirror()` (limitação)
}

function fieldSource(node: FieldIR, ctx: GenCtx, self: string): string {
  if (node.kind === "column") {
    ctx.builders.add(node.type);
    if (node.array) {
      ctx.builders.add("array");
      let s = `array(${node.type}())`;
      if (node.notNull === false) s += ".nullable()"; // arrays são notNull por padrão
      if (node.unique) s += ".unique()";
      if (node.index) s += ".index()";
      return s;
    }
    let s = `${node.type}()`;
    if (node.notNull) s += ".notNull()";
    if (node.unique) s += ".unique()";
    if (node.index) s += ".index()";
    if (node.default !== undefined) s += `.default(${JSON.stringify(node.default)})`;
    return s;
  }
  if (node.kind === "reference") {
    ctx.builders.add("reference");
    if (node.target !== self) ctx.imports.add(node.target);
    if (node.cardinality === "many") {
      ctx.builders.add("array");
      return `reference(array(${node.target}))`;
    }
    return `reference(${node.target})${node.notNull ? ".notNull()" : ""}`;
  }
  // owned
  if (node.mirror) ctx.mirror = true; // sem builder de mirror — gera o shape concreto (vazio se só mirror)
  ctx.builders.add("owned");
  const inner = shapeSource(node.shape ?? {}, ctx, self);
  return node.array ? `owned(array({ ${inner} }))` : `owned({ ${inner} })`;
}

function shapeSource(fields: Record<string, FieldIR>, ctx: GenCtx, self: string): string {
  return Object.entries(fields)
    .map(([k, n]) => `${k}: ${fieldSource(n, ctx, self)}`)
    .join(", ");
}

/** Gera o source `export default defineEntity(...)` de UMA entidade (com imports). */
export function irToSource(ir: EntityIR): string {
  const ctx: GenCtx = { builders: new Set(), imports: new Set(), mirror: false };
  const body = Object.entries(ir.fields)
    .map(([k, n]) => `  ${k}: ${fieldSource(n, ctx, ir.name)},`)
    .join("\n");

  const builders = ["defineEntity", ...[...ctx.builders].sort()];
  const lines = [`import { ${builders.join(", ")} } from "@mauroandre/weave-sdk";`];
  for (const t of [...ctx.imports].sort()) lines.push(`import ${t} from "./${t}.js";`);
  if (ctx.mirror) lines.push(`// ⚠ esta entidade usa mirror — gere/edite a forma à mão (o builder não tem mirror()).`);
  lines.push("", `export default defineEntity(${JSON.stringify(ir.name)}, {`, body, "});", "");
  return lines.join("\n");
}

/** Gera o barrel do client (`_generated/client.ts`) importando as entidades. */
export function genClientSource(entityNames: string[], entitiesRelPath = "../entities"): string {
  const imports = entityNames.map((n) => `import ${n} from "${entitiesRelPath}/${n}.js";`).join("\n");
  const entities = entityNames.join(", ");
  return [
    `// GERADO por \`weave gen\` — não edite à mão.`,
    `import { createClient } from "@mauroandre/weave-sdk";`,
    imports,
    "",
    `export const entities = { ${entities} };`,
    `export const weave = createClient({ url: process.env.WEAVE_URL!, key: process.env.WEAVE_KEY!, entities });`,
    "",
  ].join("\n");
}

export interface PullOptions {
  url: string;
  key: string;
  fetch?: FetchLike;
}

/** Puxa os IRs remotos e gera o source de cada entidade. Devolve `nome.ts → conteúdo`. */
export async function pullEntities(options: PullOptions): Promise<{ files: Record<string, string>; names: string[] }> {
  const transport: FetchLike = options.fetch ?? ((req) => globalThis.fetch(req));
  const base = options.url.replace(/\/$/, "");
  const res = await transport(
    new Request(`${base}/admin/entities`, { method: "GET", headers: { "x-api-key": options.key } }),
  );
  const json = (await res.json().catch(() => null)) as { entities?: EntityIR[]; error?: string } | null;
  if (!res.ok || !json?.entities) throw errorFor(res.status, json?.error ?? "Failed to pull entities.");

  const files: Record<string, string> = {};
  const names: string[] = [];
  for (const ir of json.entities) {
    files[`${ir.name}.ts`] = irToSource(ir);
    names.push(ir.name);
  }
  return { files, names: names.sort() };
}
