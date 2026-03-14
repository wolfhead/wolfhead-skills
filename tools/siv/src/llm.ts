import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import type { SivConfig } from "./config.js";

export interface LLMResponse<T> {
  result: T;
  usage: { input_tokens: number; output_tokens: number };
}

/** Build a config with consolidate-model overrides applied (if set). */
export function getConsolidateConfig(config: SivConfig): SivConfig {
  if (!config.consolidateModel) return config;
  return {
    ...config,
    apiKey: config.consolidateApiKey ?? config.apiKey,
    apiBase: config.consolidateApiBase ?? config.apiBase,
    model: config.consolidateModel,
  };
}

export async function callLLM<T>(
  config: SivConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse<T>> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.apiBase,
  });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 16384,
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  const parsed = extractJSON<T>(content);

  return {
    result: parsed,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Extract and parse JSON from LLM response text.
 *
 * Handles: clean JSON, markdown fences, reasoning preambles,
 * trailing text, and minor JSON syntax errors (via jsonrepair).
 */
export function extractJSON<T>(text: string): T {
  const trimmed = text.trim();

  // Fast path: direct parse
  try {
    const result = JSON.parse(trimmed);
    if (isJsonObject(result)) return result as T;
  } catch {
    // continue to fallback
  }

  // Try extracting from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      const result = JSON.parse(jsonrepair(fenceMatch[1].trim()));
      if (isJsonObject(result)) return result as T;
    } catch {
      // continue to next strategy
    }
  }

  // Try finding first JSON object or array in the text
  const jsonStart = trimmed.search(/[\[{]/);
  if (jsonStart >= 0) {
    const candidate = trimmed.slice(jsonStart);
    try {
      const result = JSON.parse(jsonrepair(candidate));
      if (isJsonObject(result)) return result as T;
    } catch {
      // continue
    }
  }

  throw new Error(`LLM returned invalid JSON: ${text.slice(0, 200)}`);
}

/** We only accept objects and arrays as valid LLM JSON output. */
function isJsonObject(value: unknown): boolean {
  return value !== null && typeof value === "object";
}
