import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";

export interface SivConfig {
  sivDir: string;
  apiKey: string;
  apiBase: string;
  model: string;
  // Optional: separate model for consolidation (group + distill + consolidate steps)
  consolidateApiKey?: string;
  consolidateApiBase?: string;
  consolidateModel?: string;
  scansPath: string;
  insightsPath: string;
  rulesPath: string;
  groupsPath: string;
  backupsDir: string;
  promotionThreshold: {
    minSessions: number;
    minOccurrences: number;
    crossProjectMinProjects: number;
  };
  promotionScoreThreshold: number;
}

export function getSivDir(homeDir?: string): string {
  const home = homeDir ?? os.homedir();
  return path.join(home, ".siv");
}

export function loadConfig(homeDir?: string): SivConfig {
  const sivDir = getSivDir(homeDir);
  const envPath = path.join(sivDir, ".env");

  // Parse .env file if it exists
  const envVars: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath, "utf-8"));
    Object.assign(envVars, parsed);
  }

  return {
    sivDir,
    apiKey: envVars.SIV_API_KEY ?? "",
    apiBase: envVars.SIV_API_BASE ?? "https://api.deepseek.com/v1",
    model: envVars.SIV_MODEL ?? "deepseek-chat",
    consolidateApiKey: envVars.SIV_CONSOLIDATE_API_KEY,
    consolidateApiBase: envVars.SIV_CONSOLIDATE_API_BASE,
    consolidateModel: envVars.SIV_CONSOLIDATE_MODEL,
    scansPath: path.join(sivDir, "scans.jsonl"),
    insightsPath: path.join(sivDir, "insights.jsonl"),
    rulesPath: path.join(sivDir, "rules.jsonl"),
    groupsPath: path.join(sivDir, "groups.jsonl"),
    backupsDir: path.join(sivDir, "backups"),
    promotionThreshold: {
      minSessions: 2,
      minOccurrences: 3,
      crossProjectMinProjects: 2,
    },
    promotionScoreThreshold: 6,
  };
}
