import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SivConfig } from "../src/config.js";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

import { callLLM } from "../src/llm.js";

const stubConfig: SivConfig = {
  sivDir: "/tmp/siv-test",
  apiKey: "test-key",
  apiBase: "https://api.example.com/v1",
  model: "test-model",
  findingsPath: "/tmp/siv-test/findings.jsonl",
  promotionsPath: "/tmp/siv-test/promotions.jsonl",
  backupsDir: "/tmp/siv-test/backups",
  promotionThreshold: {
    minSessions: 3,
    minOccurrences: 3,
    crossProjectMinProjects: 2,
  },
};

describe("callLLM", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns parsed JSON from valid response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer": 42}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const res = await callLLM<{ answer: number }>(
      stubConfig,
      "system",
      "user"
    );

    expect(res.result).toEqual({ answer: 42 });
  });

  it("passes through usage stats", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok": true}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const res = await callLLM(stubConfig, "system", "user");

    expect(res.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it("defaults usage to 0 when missing", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok": true}' } }],
      usage: undefined,
    });

    const res = await callLLM(stubConfig, "system", "user");

    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it("throws on empty response content", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });

    await expect(
      callLLM(stubConfig, "system", "user")
    ).rejects.toThrow("LLM returned empty response");
  });

  it("throws on empty choices array", async () => {
    mockCreate.mockResolvedValue({
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });

    await expect(
      callLLM(stubConfig, "system", "user")
    ).rejects.toThrow("LLM returned empty response");
  });

  it("throws on invalid JSON with helpful error message", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json at all" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await expect(
      callLLM(stubConfig, "system", "user")
    ).rejects.toThrow("LLM returned invalid JSON: not json at all");
  });
});
