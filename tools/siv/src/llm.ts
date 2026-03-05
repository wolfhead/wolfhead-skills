import OpenAI from "openai";
import type { SivConfig } from "./config.js";

export interface LLMResponse<T> {
  result: T;
  usage: { input_tokens: number; output_tokens: number };
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
    max_tokens: 4096,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }

  return {
    result: parsed,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
