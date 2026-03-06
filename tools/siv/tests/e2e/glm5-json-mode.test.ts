import { describe, it, expect } from "vitest";
import OpenAI from "openai";

const API_BASE = "https://api.ppio.com/openai";
const API_KEY = "sk_eSYj6ABccCDj2-qt9vCU1DrTWeItcOnb1gEej428BA4";
const MODEL = "zai-org/glm-5";

describe("glm-5 via ppio: response_format json_object", () => {
  it("returns pure JSON when response_format is set", async () => {
    const client = new OpenAI({ apiKey: API_KEY, baseURL: API_BASE });

    const requestBody = {
      model: MODEL,
      messages: [
        { role: "system" as const, content: "You are a JSON-only assistant. Always respond with valid JSON." },
        { role: "user" as const, content: 'Return a JSON object with fields: sentiment (positive/negative/neutral) and confidence (0.0-1.0) for this text: "I love this product!"' },
      ],
      max_tokens: 4096,
      temperature: 0.1,
      response_format: { type: "json_object" as const },
    };

    // Log full request for debugging
    console.log("=== REQUEST ===");
    console.log(`POST ${API_BASE}/chat/completions`);
    console.log(JSON.stringify(requestBody, null, 2));

    const response = await client.chat.completions.create(requestBody);

    // Log full response for debugging
    console.log("\n=== RESPONSE ===");
    console.log(JSON.stringify(response, null, 2));

    const content = response.choices[0]?.message?.content;
    console.log("\n=== RAW CONTENT ===");
    console.log(content);

    expect(content).toBeTruthy();

    // Should parse as valid JSON without any stripping
    const parsed = JSON.parse(content!);
    console.log("\n=== PARSED ===");
    console.log(parsed);

    expect(parsed).toHaveProperty("sentiment");
    expect(parsed).toHaveProperty("confidence");
  }, 30000);

  it("returns pure JSON WITHOUT response_format (baseline)", async () => {
    const client = new OpenAI({ apiKey: API_KEY, baseURL: API_BASE });

    const requestBody = {
      model: MODEL,
      messages: [
        { role: "system" as const, content: "You are a JSON-only assistant. Always respond with valid JSON. No markdown, no explanation." },
        { role: "user" as const, content: 'Return a JSON object with fields: sentiment (positive/negative/neutral) and confidence (0.0-1.0) for this text: "I love this product!"' },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    };

    console.log("=== REQUEST (no response_format) ===");
    console.log(`POST ${API_BASE}/chat/completions`);
    console.log(JSON.stringify(requestBody, null, 2));

    const response = await client.chat.completions.create(requestBody);

    console.log("\n=== RESPONSE (no response_format) ===");
    console.log(JSON.stringify(response, null, 2));

    const content = response.choices[0]?.message?.content;
    console.log("\n=== RAW CONTENT (no response_format) ===");
    console.log(content);

    // This may or may not parse — it's the baseline to compare against
    try {
      const parsed = JSON.parse(content!);
      console.log("\n=== PARSED (no response_format) ===");
      console.log(parsed);
    } catch {
      console.log("\n=== PARSE FAILED (no response_format) — this is the bug ===");
      console.log("Content is not valid JSON, reasoning leaked into content field");
    }
  }, 30000);
});
