---
name: model-selector
description: "Use ONLY when the user or a calling skill explicitly requests dynamic model selection. Do NOT auto-trigger - this skill is only invoked by direct reference (e.g. 'use /model-selector'). Classifies task attributes and returns the optimal model ID."
---

# Model Selector

## Overview

Pre-classify a task's attributes and select the cheapest model that can do the job well. Default to GLM-5 unless the task clearly needs a capability GLM-5 lacks.

<HARD-GATE>
FORBIDDEN: Selecting a model based on "quality feel" or preference. Selection MUST be based on task attributes only.

FORBIDDEN: Defaulting to the most expensive model "just in case."

MUST: Always justify the selection by citing which rule matched.
</HARD-GATE>

## Models

| Model | ID | In $/M | Out $/M | Context | Vision | Strengths |
|-------|-----|--------|---------|---------|--------|-----------|
| GLM-5 | glm-5 | 1.00 | 3.20 | 200K | no | General reasoning, agentic workflows, default |
| Sonnet 4.6 | sonnet-4.6 | 3.00 | 15.00 | 200K (1M beta) | yes | Code review, multi-file refactor, vision |
| Opus 4.6 | opus-4.6 | 5.00 | 25.00 | 200K (1M beta) | yes | Complex reasoning, architecture, long context |
| DeepSeek 3.2 | deepseek-3.2 | 0.28 | 0.42 | 128K | no | Math, competitive programming, batch |
| Qwen 3.5 | qwen-3.5 | 0.11 | 0.44 | 262K (1M hosted) | yes | Vision on budget, multilingual |
| MiniMax M2.5 | minimax-m2.5 | 0.30 | 1.20 | 200K | no | Autonomous coding, SWE tasks, tool-use chains |

## Selection Rules

Evaluate rules top-to-bottom. First match wins.

```
1. Task requires vision/image input?
   ├── Budget constrained? → qwen-3.5
   └── Quality critical?   → sonnet-4.6

2. Task is math-heavy, calculation, or competitive programming?
   → deepseek-3.2

3. Task is autonomous multi-step coding (SWE-style)?
   → minimax-m2.5

4. Task is code review or multi-file refactoring?
   → sonnet-4.6

5. Task is complex architecture design or deep debugging?
   → opus-4.6

6. Task is high-volume batch processing where cost matters?
   → deepseek-3.2

7. Task involves multilingual content (non-English dominant)?
   → qwen-3.5

8. Everything else
   → glm-5
```

## Output

Respond with the model ID only. No explanation.

## Examples

### Input: "Analyze this screenshot and extract the table data"
Output: `qwen-3.5`
Rule: #1 — vision required, no quality constraint specified

### Input: "Review the PR diff across 12 files and find bugs"
Output: `sonnet-4.6`
Rule: #4 — code review, multi-file

### Input: "Solve these 50 math competition problems"
Output: `deepseek-3.2`
Rule: #2 — math-heavy

### Input: "Fix the login bug in auth.go"
Output: `glm-5`
Rule: #8 — general task, no special requirements

### Input: "Run the SWE-bench task: resolve issue #432 autonomously"
Output: `minimax-m2.5`
Rule: #3 — autonomous multi-step coding
