export type FindingCategory = "correction" | "error" | "knowledge_gap" | "best_practice" | "feature_request";
export type Priority = "low" | "medium" | "high" | "critical";
export type FindingStatus = "pending" | "promoted" | "dismissed";
export type FindingSource = "analyze" | "manual" | "hook";

export interface Finding {
  id: string;
  ts: string;
  category: FindingCategory;
  summary: string;
  details: string;
  priority: Priority;
  project: string;
  project_path: string;
  session: string;
  tags: string[];
  related_files: string[];
  source: FindingSource;
  status: FindingStatus;
  group?: string;
}

export interface Promotion {
  id: string;
  ts: string;
  finding_ids: string[];
  scope: "project" | "global";
  project: string;
  project_path: string;
  category: string;
  rule: string;
  action_taken: string;
  status: "active" | "superseded";
}
