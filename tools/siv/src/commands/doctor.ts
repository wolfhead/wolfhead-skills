import fs from "fs";
import path from "path";
import { loadConfig, getSivDir } from "../config.js";
import OpenAI from "openai";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export async function executeDoctor(): Promise<void> {
  const results: CheckResult[] = [];

  // 1. Check ~/.siv directory exists
  const sivDir = getSivDir();
  results.push({
    name: "siv directory",
    status: fs.existsSync(sivDir) ? "pass" : "fail",
    message: fs.existsSync(sivDir) ? sivDir : `${sivDir} does not exist. Run: mkdir -p ${sivDir}`,
  });

  // 2. Check .env file exists
  const envPath = path.join(sivDir, ".env");
  const envExists = fs.existsSync(envPath);
  results.push({
    name: ".env file",
    status: envExists ? "pass" : "fail",
    message: envExists ? envPath : `${envPath} not found. Create it with SIV_API_KEY, SIV_API_BASE, SIV_MODEL`,
  });

  // 3. Load config and check fields
  const config = loadConfig();

  results.push({
    name: "SIV_API_KEY",
    status: config.apiKey ? "pass" : "fail",
    message: config.apiKey ? `set (${config.apiKey.slice(0, 8)}...)` : "not set",
  });

  results.push({
    name: "SIV_API_BASE",
    status: config.apiBase ? "pass" : "warn",
    message: config.apiBase || "using default",
  });

  results.push({
    name: "SIV_MODEL",
    status: "pass",
    message: config.model,
  });

  // 4. Check data files
  results.push({
    name: "insights.jsonl",
    status: fs.existsSync(config.insightsPath) ? "pass" : "warn",
    message: fs.existsSync(config.insightsPath)
      ? `${countLines(config.insightsPath)} insights`
      : "not yet created (will be created on first use)",
  });

  results.push({
    name: "rules.jsonl",
    status: fs.existsSync(config.rulesPath) ? "pass" : "warn",
    message: fs.existsSync(config.rulesPath)
      ? `${countLines(config.rulesPath)} rules`
      : "not yet created (will be created on first use)",
  });

  // Print config results
  console.log("siv doctor\n");
  for (const r of results) {
    const icon = r.status === "pass" ? "OK" : r.status === "warn" ? "WARN" : "FAIL";
    console.log(`  [${icon}] ${r.name}: ${r.message}`);
  }

  // 5. API connectivity test
  if (!config.apiKey) {
    console.log("\n  [SKIP] API connectivity: no API key configured");
    return;
  }

  console.log("\n  Testing API connectivity...");
  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.apiBase,
    });

    const start = Date.now();
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 10,
      temperature: 0,
    });
    const elapsed = Date.now() - start;

    const content = response.choices[0]?.message?.content?.trim();
    if (content) {
      console.log(`  [OK] API response: "${content}" (${elapsed}ms)`);
      console.log(`  [OK] Model: ${response.model ?? config.model}`);
      if (response.usage) {
        console.log(`  [OK] Tokens: ${response.usage.prompt_tokens} in / ${response.usage.completion_tokens} out`);
      }
    } else {
      console.log("  [FAIL] API returned empty response");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [FAIL] API error: ${msg}`);
  }
}

function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content ? content.split("\n").length : 0;
  } catch {
    return 0;
  }
}
