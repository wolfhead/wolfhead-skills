export type InsightCategory = "correction" | "error" | "knowledge_gap" | "best_practice" | "feature_request";
export type Priority = "low" | "medium" | "high" | "critical";
export type InsightStatus = "pending" | "consolidated" | "dismissed";
export type InsightSource = "analyze" | "manual" | "hook";

export interface Insight {
  id: string;
  ts: string;
  category: InsightCategory;
  summary: string;
  details: string;
  priority: Priority;
  project: string;
  project_path: string;
  session: string;
  tags: string[];
  related_files: string[];
  source: InsightSource;
  status: InsightStatus;
  group?: string;
}

export interface Rule {
  id: string;
  ts: string;
  insight_ids: string[];
  scope: "project" | "global";
  project: string;
  project_path: string;
  category: string;
  rule: string;
  action_taken: string;
  status: "active" | "superseded";
}
