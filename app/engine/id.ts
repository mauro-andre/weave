import { uuidv7, objectId } from "@mauroandre/weave-core";

// Server-side id strategy. `WEAVE_ID_TYPE=objectId` switches the whole instance to
// MongoDB-ObjectId-compatible 24-hex ids (a Mongo→Weave migration that must keep its
// existing ids so every front-end link stays valid). Default: UUID v7. This is a fixed
// instance property (env), so it must never change on a database that already has data.

export type IdType = "uuid" | "objectId";

/** The instance id type from `WEAVE_ID_TYPE` (`"objectId"` or, by default, `"uuid"`). */
export function idType(): IdType {
  return process.env.WEAVE_ID_TYPE === "objectId" ? "objectId" : "uuid";
}

/** The SQL type of the `id`/FK columns for the current instance id type. */
export function idSqlType(): string {
  return idType() === "objectId" ? "char(24)" : "uuid";
}

/** Generate a new id for the current instance id type (UUID v7, or ObjectId-compatible). */
export function generateId(): string {
  return idType() === "objectId" ? objectId() : uuidv7();
}
