import { catalog } from "../types/registry.js";
import { slug } from "../util/slug.js";
import { isReserved } from "../util/reserved.js";
import type { EntityIR } from "./types.js";

const CATALOG = catalog as Record<string, unknown>;

/** Confere que um JSON desconhecido é um IR bem-formado. Lança em caso de erro. */
export function validateIR(input: unknown): EntityIR {
  if (!isObj(input)) throw err("the IR must be an object.");
  if (typeof input["irVersion"] !== "number") throw err("`irVersion` must be a number.");
  if (typeof input["name"] !== "string" || !input["name"]) {
    throw err("`name` must be a non-empty string.");
  }
  checkName(input["name"]); // nome da entidade vira uma tabela "pelada"
  if (!isObj(input["fields"])) throw err("`fields` must be an object.");
  for (const [key, node] of Object.entries(input["fields"])) {
    validateNode(node, key, `${input["name"]}.${key}`);
  }
  return input as unknown as EntityIR;
}

function validateNode(node: unknown, name: string, path: string): void {
  if (!isObj(node)) throw err(`${path}: invalid node.`);
  switch (node["kind"]) {
    case "column": {
      checkName(name); // coluna escalar vira um identificador "pelado"
      const type = node["type"];
      if (typeof type !== "string" || !(type in CATALOG)) {
        throw err(`${path}: type '${String(type)}' is not in the catalog.`);
      }
      return;
    }
    case "reference": {
      // A coluna é `${name}_id` (segura), então o nome do campo não é checado.
      if (typeof node["target"] !== "string") throw err(`${path}: \`target\` must be a string.`);
      if (node["cardinality"] !== "one" && node["cardinality"] !== "many") {
        throw err(`${path}: \`cardinality\` must be 'one' or 'many'.`);
      }
      return;
    }
    case "owned": {
      // A tabela filha é `pai__filho` (segura); só os campos internos são checados.
      if (typeof node["array"] !== "boolean") throw err(`${path}: \`array\` must be a boolean.`);
      const hasMirror = typeof node["mirror"] === "string";
      // Sem mirror, `shape` é obrigatório (forma inline). Com mirror, `shape` é
      // opcional e carrega os campos locais (extras) — resolvido no sync.
      if (!hasMirror && !isObj(node["shape"])) {
        throw err(`${path}: owned needs \`shape\` or \`mirror\`.`);
      }
      if (node["shape"] !== undefined) {
        if (!isObj(node["shape"])) throw err(`${path}: \`shape\` must be an object.`);
        for (const [key, child] of Object.entries(node["shape"])) {
          validateNode(child, key, `${path}.${key}`);
        }
      }
      return;
    }
    default:
      throw err(`${path}: invalid \`kind\` '${String(node["kind"])}'.`);
  }
}

// Bloqueia nomes que viram identificador "pelado" e colidem com palavra reservada
// do Postgres (ex.: `user`, `order`, `select`). Mensagem amigável, sem SQL.
function checkName(raw: string): void {
  const s = slug(raw);
  if (isReserved(s)) {
    throw err(`'${s}' is a reserved word and can't be used as a name. Try '${s}s' or another name.`);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(msg: string): Error {
  return new Error(`Invalid IR — ${msg}`);
}
