import { describe, it, expectTypeOf } from "vitest";
import {
  array,
  defineEntity,
  int4,
  int8,
  owned,
  text,
  type InferInsert,
} from "../../app/engine/index.js";

describe("InferInsert", () => {
  const user = defineEntity("users", {
    name: text().notNull(), // required
    email: text().notNull(), // required
    age: int4().notNull().default(0), // optional (has default)
    bio: text(), // optional (nullable)
    tags: array(text()), // optional (array default '{}')
    addresses: owned(array({ street: text().notNull() })), // optional (owned)
  });

  it("marks notNull-without-default as required, the rest optional", () => {
    expectTypeOf<InferInsert<typeof user>>().toEqualTypeOf<{
      id?: string;
      name: string;
      email: string;
      age?: number;
      bio?: string | null;
      tags?: string[];
      addresses?: Array<{ id?: string; street: string }>;
    }>();
  });

  it("nests owned insert types with optional id and no timestamps", () => {
    type Addr = NonNullable<InferInsert<typeof user>["addresses"]>[number];
    expectTypeOf<Addr>().toEqualTypeOf<{ id?: string; street: string }>();
  });
});

// int8 é backed por `bigint`, mas `.default()` e o valor de escrita aceitam
// `number | bigint` (ergonomia igual int2/int4; o int8 puro-bigint quebrava o
// `weave gen` e o typecheck do consumidor). int2/int4 seguem `number` estrito.
describe("int8 (bigint-backed) — default & write value = number | bigint", () => {
  const rec = defineEntity("bigrecs", {
    size: int8().notNull().default(0), // .default(0) (number) — era o bug do report
    seq: int8().notNull().default(0n), // .default(0n) (bigint) segue válido
    total: int8().notNull(), // required, sem default
    note: int8(), // nullable
  });

  it("valor de escrita do int8 é number | bigint (required e opcionais)", () => {
    expectTypeOf<InferInsert<typeof rec>>().toEqualTypeOf<{
      id?: string;
      total: number | bigint;
      size?: number | bigint;
      seq?: number | bigint;
      note?: number | bigint | null;
    }>();
  });

  it("int4 continua estrito em number (não aceita bigint)", () => {
    int4().default(0); // ok
    // @ts-expect-error — int4 é Column<number>; 0n (bigint) não é aceito
    int4().default(0n);
  });
});
