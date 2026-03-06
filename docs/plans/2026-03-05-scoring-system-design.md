# Scoring System for Finding Promotion

## Problem

Important findings like user corrections get stuck as singletons because promotion requires group size >= 2. A scoring system adds an alternative promotion path based on signal confidence.

## How it works

**Score = category_base × priority_multiplier**

| Category | Base | | Priority | Multiplier |
|----------|------|-|----------|-----------|
| correction | 3 | | critical | 4 |
| error | 2 | | high | 3 |
| knowledge_gap | 1 | | medium | 2 |
| best_practice | 1 | | low | 1 |
| feature_request | 0 | | | |

**Promotion threshold: 6**

A finding qualifies for promotion if:
- `group_size >= 2` (existing path), OR
- `score >= 6` (new path — singleton promotion)

## Changes

1. **`src/scoring.ts`** (new) — `scoreFinding(category, priority): number` pure function
2. **`run-promotion.ts`** — After building groups, also collect ungrouped/singleton findings with score >= 6. Feed both to distill + promote.
3. **`src/config.ts`** — Add `promotionScoreThreshold: 6` to config (so it's tunable)
4. **Tests** — Unit tests for scoring function, integration test for score-based singleton promotion

## What stays the same

- Finding type — no new fields (score is computed, not stored)
- Analyze prompt — no changes
- Group command — no changes
- Promote/retrieve — no changes
