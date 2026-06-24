import { describe, it, expectTypeOf } from "vitest";
import {
  type Infer,
  int2,
  int4,
  int8,
  numeric,
  float4,
  float8,
  text,
  varchar,
  bpchar,
  timestamptz,
  timestamp,
  date,
  time,
  interval,
  bool,
  uuid,
  json,
  jsonb,
  bytea,
} from "../../app/engine/types/index.js";

/**
 * Compile-time tests: the phantom `tsType` must recover the exact TS type a
 * column hydrates to. These never run; `vitest typecheck` asserts them.
 */
describe("type inference", () => {
  it("maps PG types to the agreed TS types", () => {
    expectTypeOf<Infer<typeof int2>>().toEqualTypeOf<number>();
    expectTypeOf<Infer<typeof int4>>().toEqualTypeOf<number>();
    expectTypeOf<Infer<typeof int8>>().toEqualTypeOf<bigint>();
    expectTypeOf<Infer<typeof numeric>>().toEqualTypeOf<number>();
    expectTypeOf<Infer<typeof float4>>().toEqualTypeOf<number>();
    expectTypeOf<Infer<typeof float8>>().toEqualTypeOf<number>();

    expectTypeOf<Infer<typeof text>>().toEqualTypeOf<string>();
    expectTypeOf<Infer<typeof varchar>>().toEqualTypeOf<string>();
    expectTypeOf<Infer<typeof bpchar>>().toEqualTypeOf<string>();

    expectTypeOf<Infer<typeof timestamptz>>().toEqualTypeOf<Date>();
    expectTypeOf<Infer<typeof timestamp>>().toEqualTypeOf<Date>();
    expectTypeOf<Infer<typeof date>>().toEqualTypeOf<Date>();
    expectTypeOf<Infer<typeof time>>().toEqualTypeOf<string>();
    expectTypeOf<Infer<typeof interval>>().toEqualTypeOf<string>();

    expectTypeOf<Infer<typeof bool>>().toEqualTypeOf<boolean>();
    expectTypeOf<Infer<typeof uuid>>().toEqualTypeOf<string>();

    expectTypeOf<Infer<typeof json>>().toEqualTypeOf<unknown>();
    expectTypeOf<Infer<typeof jsonb>>().toEqualTypeOf<unknown>();

    expectTypeOf<Infer<typeof bytea>>().toEqualTypeOf<Uint8Array>();
  });

  it("preserves the literal name as a discriminant", () => {
    expectTypeOf(int4.name).toEqualTypeOf<"int4">();
    expectTypeOf(timestamptz.name).toEqualTypeOf<"timestamptz">();
  });
});
