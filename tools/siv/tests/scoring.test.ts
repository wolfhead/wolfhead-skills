import { describe, it, expect } from "vitest";
import { scoreFinding } from "../src/scoring.js";

describe("scoreFinding", () => {
  it("correction + critical = 12", () => {
    expect(scoreFinding("correction", "critical")).toBe(12);
  });

  it("correction + high = 9", () => {
    expect(scoreFinding("correction", "high")).toBe(9);
  });

  it("correction + medium = 6", () => {
    expect(scoreFinding("correction", "medium")).toBe(6);
  });

  it("correction + low = 3", () => {
    expect(scoreFinding("correction", "low")).toBe(3);
  });

  it("error + high = 6", () => {
    expect(scoreFinding("error", "high")).toBe(6);
  });

  it("error + medium = 4", () => {
    expect(scoreFinding("error", "medium")).toBe(4);
  });

  it("best_practice + medium = 2", () => {
    expect(scoreFinding("best_practice", "medium")).toBe(2);
  });

  it("knowledge_gap + high = 3", () => {
    expect(scoreFinding("knowledge_gap", "high")).toBe(3);
  });

  it("feature_request + critical = 0", () => {
    expect(scoreFinding("feature_request", "critical")).toBe(0);
  });

  // Threshold tests (threshold = 6)
  it("scores >= 6 for singleton promotion", () => {
    // These should qualify
    expect(scoreFinding("correction", "critical")).toBeGreaterThanOrEqual(6);
    expect(scoreFinding("correction", "high")).toBeGreaterThanOrEqual(6);
    expect(scoreFinding("correction", "medium")).toBeGreaterThanOrEqual(6);
    expect(scoreFinding("error", "critical")).toBeGreaterThanOrEqual(6);
    expect(scoreFinding("error", "high")).toBeGreaterThanOrEqual(6);

    // These should NOT qualify
    expect(scoreFinding("correction", "low")).toBeLessThan(6);
    expect(scoreFinding("error", "medium")).toBeLessThan(6);
    expect(scoreFinding("best_practice", "high")).toBeLessThan(6);
    expect(scoreFinding("knowledge_gap", "critical")).toBeLessThan(6);
    expect(scoreFinding("feature_request", "critical")).toBeLessThan(6);
  });
});
