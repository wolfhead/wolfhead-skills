import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";

export interface SivConfig {
  sivDir: string;
  apiKey: string;
  apiBase: string;
  model: string;
  // Optional: separate model for promotion (group + distill + promote steps)
  promoteApiKey?: string;
  promoteApiBase?: string;
  promoteModel?: string;
  scansPath: string;
  findingsPath: string;
  promotionsPath: string;
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
    promoteApiKey: envVars.SIV_PROMOTE_API_KEY,
    promoteApiBase: envVars.SIV_PROMOTE_API_BASE,
    promoteModel: envVars.SIV_PROMOTE_MODEL,
    scansPath: path.join(sivDir, "scans.jsonl"),
    findingsPath: path.join(sivDir, "findings.jsonl"),
    promotionsPath: path.join(sivDir, "promotions.jsonl"),
    backupsDir: path.join(sivDir, "backups"),
    promotionThreshold: {
      minSessions: 2,
      minOccurrences: 3,
      crossProjectMinProjects: 2,
    },
    promotionScoreThreshold: 6,
  };
}
