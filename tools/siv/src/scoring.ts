/**
 * Score a finding based on category and priority.
 *
 * Score = category_base × priority_multiplier
 *
 * Higher scores indicate higher confidence that the finding
 * is worth promoting, even as a singleton.
 */

import type { FindingCategory, Priority } from "./types.js";

const CATEGORY_BASE: Record<FindingCategory, number> = {
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

export function scoreFinding(category: FindingCategory, priority: Priority): number {
  return CATEGORY_BASE[category] * PRIORITY_MULTIPLIER[priority];
}
