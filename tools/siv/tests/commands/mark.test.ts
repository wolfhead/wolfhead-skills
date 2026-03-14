import { describe, it, expect } from "vitest";
import { executeMark } from "../../src/commands/mark.js";

describe("executeMark", () => {
  it("returns 'marked' for valid type", () => {
    expect(executeMark("frustration", "stuck on API")).toBe("marked");
  });

  it("accepts unknown types silently", () => {
    expect(executeMark("curiosity", "interesting")).toBe("marked");
  });

  it("works without context", () => {
    expect(executeMark("breakthrough")).toBe("marked");
  });
});
