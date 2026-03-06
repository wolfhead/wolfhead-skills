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

import { callLLM, extractJSON } from "../src/llm.js";

const stubConfig: SivConfig = {
  sivDir: "/tmp/siv-test",
  apiKey: "test-key",
  apiBase: "https://api.example.com/v1",
  model: "test-model",
  scansPath: "/tmp/siv-test/scans.jsonl",
  findingsPath: "/tmp/siv-test/findings.jsonl",
  promotionsPath: "/tmp/siv-test/promotions.jsonl",
  backupsDir: "/tmp/siv-test/backups",
  promotionThreshold: {
    minSessions: 3,
    minOccurrences: 3,
    crossProjectMinProjects: 2,
  },
  promotionScoreThreshold: 6,
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
      choices: [{ message: { content: "I cannot help with that request." } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await expect(
      callLLM(stubConfig, "system", "user")
    ).rejects.toThrow("LLM returned invalid JSON");
  });

  it("strips markdown code fences from response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '```json\n{"answer": 42}\n```' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const res = await callLLM<{ answer: number }>(stubConfig, "system", "user");
    expect(res.result).toEqual({ answer: 42 });
  });

  // Failure mode 1: Reasoning model puts chain-of-thought text before JSON in content field
  // glm-5 via ppio proxy leaks reasoning into content instead of reasoning_content
  it("extracts JSON when reasoning preamble precedes it", async () => {
    const content =
      'Looking at this session transcript, I can see several patterns...\n\n' +
      'The agent made good use of parallel tool calls but missed some optimization opportunities.\n\n' +
      '{"findings": [{"title": "test", "description": "test finding", "category": "pattern", "severity": "medium", "evidence": ["line 1"]}]}';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const res = await callLLM<{ findings: unknown[] }>(stubConfig, "system", "user");
    expect(res.result.findings).toHaveLength(1);
    expect(res.result.findings[0]).toMatchObject({ title: "test" });
  });

  // Failure mode 2: Reasoning model emits doubled/nested markdown fences
  it("extracts JSON from doubled markdown fences", async () => {
    const content =
      '```json\n```\n' +
      '{"findings": [{"title": "test", "description": "test finding"}]}\n' +
      '```\n```';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const res = await callLLM<{ findings: unknown[] }>(stubConfig, "system", "user");
    expect(res.result.findings).toHaveLength(1);
  });

  // Failure mode 2 variant: trailing reasoning after closing fence
  it("extracts JSON when trailing text follows closing fence", async () => {
    const content =
      '```json\n' +
      '{"findings": [{"title": "test", "description": "test finding"}]}\n' +
      '```\n\n' +
      'Some additional reasoning about the analysis...';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const res = await callLLM<{ findings: unknown[] }>(stubConfig, "system", "user");
    expect(res.result.findings).toHaveLength(1);
  });
});

describe("extractJSON", () => {
  it("parses clean JSON directly", () => {
    expect(extractJSON('{"a": 1}')).toEqual({ a: 1 });
  });

  it("handles trailing commas via jsonrepair", () => {
    expect(extractJSON('{"a": 1, "b": [1, 2, 3,],}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("extracts JSON from markdown fences with trailing text", () => {
    const text = '```json\n{"ok": true}\n```\n\nExtra text here.';
    expect(extractJSON(text)).toEqual({ ok: true });
  });

  it("extracts JSON after reasoning preamble", () => {
    const text = 'Let me think about this...\n\n{"result": "done"}';
    expect(extractJSON(text)).toEqual({ result: "done" });
  });

  it("handles leading/trailing whitespace", () => {
    expect(extractJSON('\n\n  {"a": 1}  \n\n')).toEqual({ a: 1 });
  });

  it("throws on completely invalid content", () => {
    expect(() => extractJSON("I cannot help with that request.")).toThrow("LLM returned invalid JSON");
  });
});
