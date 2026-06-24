import { catalog } from "../types/registry.js";
import type { EntityIR } from "./types.js";

const CATALOG = catalog as Record<string, unknown>;

/** Confere que um JSON desconhecido é um IR bem-formado. Lança em caso de erro. */
export function validateIR(input: unknown): EntityIR {
  if (!isObj(input)) throw err("the IR must be an object.");
  if (typeof input["irVersion"] !== "number") throw err("`irVersion` must be a number.");
  if (typeof input["name"] !== "string" || !input["name"]) {
    throw err("`name` must be a non-empty string.");
  }
  if (!isObj(input["fields"])) throw err("`fields` must be an object.");
  for (const [key, node] of Object.entries(input["fields"])) {
    validateNode(node, `${input["name"]}.${key}`);
  }
  return input as unknown as EntityIR;
}

function validateNode(node: unknown, path: string): void {
  if (!isObj(node)) throw err(`${path}: invalid node.`);
  switch (node["kind"]) {
    case "column": {
      const type = node["type"];
      if (typeof type !== "string" || !(type in CATALOG)) {
        throw err(`${path}: type '${String(type)}' is not in the catalog.`);
      }
      return;
    }
    case "reference": {
      if (typeof node["target"] !== "string") throw err(`${path}: \`target\` must be a string.`);
      if (node["cardinality"] !== "one" && node["cardinality"] !== "many") {
        throw err(`${path}: \`cardinality\` must be 'one' or 'many'.`);
      }
      return;
    }
    case "owned": {
      if (typeof node["array"] !== "boolean") throw err(`${path}: \`array\` must be a boolean.`);
      if (!isObj(node["shape"])) throw err(`${path}: \`shape\` must be an object.`);
      for (const [key, child] of Object.entries(node["shape"])) {
        validateNode(child, `${path}.${key}`);
      }
      return;
    }
    default:
      throw err(`${path}: invalid \`kind\` '${String(node["kind"])}'.`);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(msg: string): Error {
  return new Error(`Invalid IR — ${msg}`);
}
