import { describe, it, expect } from "vitest";
import {
  parseDuration,
  bucketStart,
  partitionSuffix,
  partitionName,
  renderCreatePartition,
  renderDropPartition,
  upperBoundEpoch,
} from "../../app/engine/ddl/partition.js";

// Matemática de bucket + render de DDL de partição. Puro, sem DB.

const DAY = 86400;
const jul2 = Date.UTC(2026, 6, 2) / 1000; // 2026-07-02T00:00:00Z (mês 0-based: 6 = julho)

describe("partition — duração e bucket", () => {
  it("parseDuration cobre s/min/h/d", () => {
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("5min")).toBe(300);
    expect(parseDuration("1h")).toBe(3600);
    expect(parseDuration("1d")).toBe(86400);
    expect(parseDuration("30d")).toBe(2592000);
    expect(() => parseDuration("1 dia")).toThrow(/invalid duration/);
    expect(() => parseDuration("d")).toThrow();
  });

  it("bucketStart faz epoch-floor no intervalo", () => {
    expect(bucketStart(jul2 + 3600 * 5, DAY)).toBe(jul2); // 5h dentro do dia → início do dia
    expect(bucketStart(jul2, DAY)).toBe(jul2); // já no limite
    expect(bucketStart(jul2 + DAY - 1, DAY)).toBe(jul2); // 1s antes da virada
    expect(bucketStart(jul2 + DAY, DAY)).toBe(jul2 + DAY); // virou o dia
  });
});

describe("partition — nome e sufixo", () => {
  it("granularidade diária → YYYY_MM_DD", () => {
    expect(partitionSuffix(jul2, DAY)).toBe("2026_07_02");
    expect(partitionName("app_request", jul2, DAY)).toBe("app_request_2026_07_02");
  });

  it("granularidade horária adiciona _HH", () => {
    expect(partitionSuffix(jul2 + 3600 * 13, 3600)).toBe("2026_07_02_13");
  });

  it("granularidade de minuto adiciona _HHMM", () => {
    expect(partitionSuffix(jul2 + 60 * (13 * 60 + 5), 300)).toBe("2026_07_02_1305");
  });
});

describe("partition — DDL nativa", () => {
  it("CREATE … IF NOT EXISTS PARTITION OF … FOR VALUES (idempotente)", () => {
    const sql = renderCreatePartition("app_request", "app_request_2026_07_02", jul2, DAY);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app_request_2026_07_02 PARTITION OF app_request");
    expect(sql).toContain("FROM ('2026-07-02T00:00:00.000Z') TO ('2026-07-03T00:00:00.000Z')");
  });

  it("DROP de partição inteira (não DELETE)", () => {
    expect(renderDropPartition("app_request_2026_06_01")).toBe("DROP TABLE IF EXISTS app_request_2026_06_01;");
  });

  it("upperBoundEpoch extrai o TO do relpartbound", () => {
    const bounds = "FOR VALUES FROM ('2026-07-02 00:00:00+00') TO ('2026-07-03 00:00:00+00')";
    expect(upperBoundEpoch(bounds)).toBe(Date.UTC(2026, 6, 3) / 1000);
    expect(upperBoundEpoch("DEFAULT")).toBeNull();
  });
});
