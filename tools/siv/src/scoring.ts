/**
 * Score an insight based on category and priority.
 *
 * Score = category_base x priority_multiplier
 *
 * Higher scores indicate higher confidence that the insight
 * is worth consolidating, even as a singleton.
 */

import type { InsightCategory, Priority } from "./types.js";

const CATEGORY_BASE: Record<InsightCategory, number> = {
  correction: 3,
  error: 2,
  knowledge_gap: 1,
  best_practice: 1,
  feature_request: 0,
};

const PRIORITY_MULTIPLIER: Record<Priority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function scoreInsight(category: InsightCategory, priority: Priority): number {
  return CATEGORY_BASE[category] * PRIORITY_MULTIPLIER[priority];
}
