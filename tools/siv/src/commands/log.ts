import type { Finding, FindingCategory, Priority, FindingSource } from "../types.js";
import { loadConfig } from "../config.js";
import { generateId, appendJsonl } from "../storage.js";

export interface LogOptions {
  category: FindingCategory;
  summary: string;
  details?: string;
  priority?: Priority;
  project?: string;
  projectPath?: string;
  session?: string;
  source?: FindingSource;
  tags?: string;
  related?: string;
}

export interface LogResult {
  id: string;
  status: string;
}

export function executeLog(options: LogOptions, homeDir?: string): LogResult {
  const config = loadConfig(homeDir);
  const id = generateId(options.category);

  const tags = options.tags
    ? options.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const relatedFiles = options.related
    ? options.related.split(",").map((f) => f.trim()).filter(Boolean)
    : [];

  const finding: Finding = {
    id,
    ts: new Date().toISOString(),
    category: options.category,
    summary: options.summary,
    details: options.details ?? "",
    priority: options.priority ?? "medium",
    project: options.project ?? "",
    project_path: options.projectPath ?? "",
    session: options.session ?? "",
    tags,
    related_files: relatedFiles,
    source: options.source ?? "manual",
    status: "pending",
  };

  appendJsonl(config.findingsPath, finding as unknown as Record<string, unknown>);

  return { id, status: "logged" };
}
