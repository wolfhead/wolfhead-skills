import { describe, it, expect } from "vitest";
import { scoreInsight } from "../src/scoring.js";

describe("scoreInsight", () => {
  it("correction + critical = 12", () => {
    expect(scoreInsight("correction", "critical")).toBe(12);
  });

  it("correction + high = 9", () => {
    expect(scoreInsight("correction", "high")).toBe(9);
  });

  it("correction + medium = 6", () => {
    expect(scoreInsight("correction", "medium")).toBe(6);
  });

  it("correction + low = 3", () => {
    expect(scoreInsight("correction", "low")).toBe(3);
  });

  it("error + high = 6", () => {
    expect(scoreInsight("error", "high")).toBe(6);
  });

  it("error + medium = 4", () => {
    expect(scoreInsight("error", "medium")).toBe(4);
  });

  it("best_practice + medium = 2", () => {
    expect(scoreInsight("best_practice", "medium")).toBe(2);
  });

  it("knowledge_gap + high = 3", () => {
    expect(scoreInsight("knowledge_gap", "high")).toBe(3);
  });

  it("feature_request + critical = 0", () => {
    expect(scoreInsight("feature_request", "critical")).toBe(0);
  });

  // Threshold tests (threshold = 6)
  it("scores >= 6 for singleton consolidation", () => {
    // These should qualify
    expect(scoreInsight("correction", "critical")).toBeGreaterThanOrEqual(6);
    expect(scoreInsight("correction", "high")).toBeGreaterThanOrEqual(6);
    expect(scoreInsight("correction", "medium")).toBeGreaterThanOrEqual(6);
    expect(scoreInsight("error", "critical")).toBeGreaterThanOrEqual(6);
    expect(scoreInsight("error", "high")).toBeGreaterThanOrEqual(6);

    // These should NOT qualify
    expect(scoreInsight("correction", "low")).toBeLessThan(6);
    expect(scoreInsight("error", "medium")).toBeLessThan(6);
    expect(scoreInsight("best_practice", "high")).toBeLessThan(6);
    expect(scoreInsight("knowledge_gap", "critical")).toBeLessThan(6);
    expect(scoreInsight("feature_request", "critical")).toBeLessThan(6);
  });
});
