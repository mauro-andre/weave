import { describe, it, expect } from "vitest";
import {
  array,
  defineEntity,
  int8,
  owned,
  rehydrate,
  text,
  timestamptz,
} from "../../app/engine/index.js";

describe("rehydrate", () => {
  it("restores Date, bigint, and system timestamps", () => {
    const entity = defineEntity("events", {
      label: text().notNull(),
      at: timestamptz(),
      count: int8().notNull(),
    });

    const raw = {
      id: "019ee5-...",
      label: "x",
      at: "2026-06-20T12:00:00.000Z",
      count: "42",
      createdAt: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-20T11:00:00.000Z",
    };

    const out = rehydrate(entity.columns, { ...raw });
    expect(out.at).toBeInstanceOf(Date);
    expect((out.at as unknown as Date).toISOString()).toBe("2026-06-20T12:00:00.000Z");
    expect(out.count).toBe(42n);
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.updatedAt).toBeInstanceOf(Date);
    expect(out.id).toBe("019ee5-..."); // id stays a string
  });

  it("leaves null scalars untouched", () => {
    const entity = defineEntity("events", { at: timestamptz() });
    const out = rehydrate(entity.columns, {
      id: "1",
      at: null,
      createdAt: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-20T10:00:00.000Z",
    });
    expect(out.at).toBeNull();
  });

  it("recurses into owned children (array and object)", () => {
    const user = defineEntity("users", {
      addresses: owned(array({ since: timestamptz() })),
      profile: owned({ joinedAt: timestamptz() }),
    });

    const out = rehydrate(user.columns, {
      id: "u1",
      addresses: [
        {
          id: "a1",
          since: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      profile: {
        id: "p1",
        joinedAt: "2025-12-01T00:00:00.000Z",
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2025-12-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const addresses = out.addresses as unknown as Array<{ since: Date; createdAt: Date }>;
    expect(addresses[0]!.since).toBeInstanceOf(Date);
    expect(addresses[0]!.createdAt).toBeInstanceOf(Date);
    expect((out.profile as unknown as { joinedAt: Date }).joinedAt).toBeInstanceOf(Date);
  });
});
