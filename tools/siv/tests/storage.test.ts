import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { generateId, appendJsonl, readJsonl, updateFindingStatus } from "../src/storage.js";

describe("storage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-storage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateId", () => {
    it("generates LRN prefix for non-error categories", () => {
      const id = generateId("correction");
      expect(id).toMatch(/^LRN-\d{8}-[0-9a-f]{3}$/);
    });

    it("generates ERR prefix for error category", () => {
      const id = generateId("error");
      expect(id).toMatch(/^ERR-\d{8}-[0-9a-f]{3}$/);
    });

    it("includes today's date", () => {
      const id = generateId("best_practice");
      const now = new Date();
      const expected =
        now.getFullYear().toString() +
        (now.getMonth() + 1).toString().padStart(2, "0") +
        now.getDate().toString().padStart(2, "0");
      expect(id).toContain(expected);
    });
  });

  describe("appendJsonl / readJsonl", () => {
    it("roundtrips a single record", () => {
      const filePath = path.join(tmpDir, "test.jsonl");
      const record = { id: "LRN-20260305-abc", summary: "test" };
      appendJsonl(filePath, record);

      const results = readJsonl<typeof record>(filePath);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(record);
    });

    it("appends multiple records", () => {
      const filePath = path.join(tmpDir, "test.jsonl");
      appendJsonl(filePath, { id: "1", value: "a" });
      appendJsonl(filePath, { id: "2", value: "b" });
      appendJsonl(filePath, { id: "3", value: "c" });

      const results = readJsonl<{ id: string; value: string }>(filePath);
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("1");
      expect(results[2].id).toBe("3");
    });

    it("creates parent directories if needed", () => {
      const filePath = path.join(tmpDir, "nested", "deep", "test.jsonl");
      appendJsonl(filePath, { hello: "world" });

      const results = readJsonl<{ hello: string }>(filePath);
      expect(results).toHaveLength(1);
      expect(results[0].hello).toBe("world");
    });

    it("returns empty array for missing file", () => {
      const results = readJsonl(path.join(tmpDir, "nonexistent.jsonl"));
      expect(results).toEqual([]);
    });

    it("skips malformed lines", () => {
      const filePath = path.join(tmpDir, "test.jsonl");
      fs.writeFileSync(filePath, '{"good":"data"}\nnot json\n{"also":"good"}\n');

      const results = readJsonl<{ good?: string; also?: string }>(filePath);
      expect(results).toHaveLength(2);
    });
  });

  describe("updateFindingStatus", () => {
    it("updates status of matching findings", () => {
      const filePath = path.join(tmpDir, "findings.jsonl");
      appendJsonl(filePath, { id: "LRN-001", status: "pending", summary: "a" });
      appendJsonl(filePath, { id: "LRN-002", status: "pending", summary: "b" });
      appendJsonl(filePath, { id: "LRN-003", status: "pending", summary: "c" });

      updateFindingStatus(filePath, ["LRN-001", "LRN-003"], "promoted");

      const results = readJsonl<{ id: string; status: string }>(filePath);
      expect(results[0].status).toBe("promoted");
      expect(results[1].status).toBe("pending");
      expect(results[2].status).toBe("promoted");
    });

    it("does nothing for missing file", () => {
      // Should not throw
      updateFindingStatus(path.join(tmpDir, "nope.jsonl"), ["id1"], "promoted");
    });
  });
});
