import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadConfig, getSivDir } from "../src/config.js";

describe("config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getSivDir", () => {
    it("returns ~/.siv for given home dir", () => {
      expect(getSivDir(tmpDir)).toBe(path.join(tmpDir, ".siv"));
    });
  });

  describe("loadConfig", () => {
    it("returns defaults when no .env exists", () => {
      const config = loadConfig(tmpDir);
      expect(config.sivDir).toBe(path.join(tmpDir, ".siv"));
      expect(config.apiKey).toBe("");
      expect(config.apiBase).toBe("https://api.deepseek.com/v1");
      expect(config.model).toBe("deepseek-chat");
      expect(config.findingsPath).toBe(path.join(tmpDir, ".siv", "findings.jsonl"));
      expect(config.promotionsPath).toBe(path.join(tmpDir, ".siv", "promotions.jsonl"));
      expect(config.backupsDir).toBe(path.join(tmpDir, ".siv", "backups"));
    });

    it("reads API key from .env", () => {
      const sivDir = path.join(tmpDir, ".siv");
      fs.mkdirSync(sivDir, { recursive: true });
      fs.writeFileSync(path.join(sivDir, ".env"), "SIV_API_KEY=sk-test-key-123\n");

      const config = loadConfig(tmpDir);
      expect(config.apiKey).toBe("sk-test-key-123");
      expect(config.apiBase).toBe("https://api.deepseek.com/v1");
      expect(config.model).toBe("deepseek-chat");
    });

    it("reads model and endpoint from .env", () => {
      const sivDir = path.join(tmpDir, ".siv");
      fs.mkdirSync(sivDir, { recursive: true });
      fs.writeFileSync(
        path.join(sivDir, ".env"),
        "SIV_API_KEY=sk-key\nSIV_API_BASE=https://custom.api.com/v2\nSIV_MODEL=gpt-4o\n"
      );

      const config = loadConfig(tmpDir);
      expect(config.apiKey).toBe("sk-key");
      expect(config.apiBase).toBe("https://custom.api.com/v2");
      expect(config.model).toBe("gpt-4o");
    });
  });
});
