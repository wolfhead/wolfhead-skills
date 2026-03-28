---
name: running-retro
description: >
  Use when the user asks to run a retrospective, self-review, or self-improvement
  analysis. Triggers on "run retro", "retrospective", "self-review", "how can I improve",
  "analyze my sessions", "self-improvement". Gathers session data via siv extract and
  Prometheus metrics, analyzes patterns, and produces an improvement proposal report.
---

# Self-Improvement Retrospective

Analyze your own recent sessions and metrics to find patterns that suggest how you, your skills, or the system should improve. Produce a report for human review.

<HARD-GATE>
This is a READ-ONLY analysis. You produce a report file and nothing else.

FORBIDDEN:
- Modifying any skill, memory, config, code, or system file
- Creating or editing files other than the retro report
- Acting on your own proposals (no self-modification)
- Running commands that change state (only reads and queries)
</HARD-GATE>

Always respond in the same language the user is using.

## Workflow

Copy this checklist and check off items as you complete them:

- [ ] Step 1: Gather session data
- [ ] Step 2: Gather Prometheus metrics
- [ ] Step 3: Analyze with lenses
- [ ] Step 4: Write report

### Step 1: Gather session data

Run siv extract with --summary to get compact session data:

```bash
siv extract --since <YYYY-MM-DD of 24h ago> --latest 50 --summary
```

This outputs JSON with per-session: metadata (tokens, cost, duration), tool_usage_summary, skills invoked, tool_failures, emotion_markers, and human messages (truncated). Assistant turns are omitted in summary mode — their signals are in the structured fields.

If you need full conversation for a specific session, drill down without --summary:

```bash
siv extract --session <session-id>
```

If no sessions are found, note this in the report and skip to Step 2.

### Step 2: Gather Prometheus metrics

Query Prometheus for the last 24h. Run each query via curl:

```bash
# Skill calls by name (last 24h)
curl -s 'http://prometheus:9090/api/v1/query?query=sum+by+(skill_name)(increase(claude_skill_call_total[24h]))'

# Tool call failures by tool (last 24h)
curl -s 'http://prometheus:9090/api/v1/query?query=sum+by+(tool_name)(increase(claude_tool_call_total{status="failure"}[24h]))'

# Total queries and cost (last 24h)
curl -s 'http://prometheus:9090/api/v1/query?query=increase(claude_query_total[24h])'

# Query duration p95 (last 24h)
curl -s 'http://prometheus:9090/api/v1/query?query=histogram_quantile(0.95,+rate(claude_query_duration_seconds_bucket[24h]))'
```

If Prometheus is unreachable, note this in the report and continue with session data only.

### Step 3: Analyze with lenses

Read the gathered data and analyze through these lenses:

**Skill effectiveness** — Which skills are called most? Which have high failure rates? Which are slow? Which are installed but never used? Cross-reference Prometheus skill_call_total with session skill invocations.

**Capability gaps** — What did users ask for that you couldn't do well? Look for: sessions with many tool failures, long sessions with low output, conversations where you had to say "I can't do that."

**Recurring friction** — Same type of error or confusion happening across multiple sessions. Look for: repeated tool_failures with the same tool, similar user messages that lead to dead ends.

**Cost/efficiency** — Unusually expensive or long-running sessions. Why? Large context windows, excessive tool calls, retries?

**Memory opportunities** — Knowledge you kept re-discovering across sessions. Look for: same searches or lookups repeated, same clarifying questions to users.

### Step 4: Write report

Create the retro report directory if needed, then write the report:

```bash
mkdir -p /app/data/retro
```

Write to `/app/data/retro/YYYY-MM-DD.md` (use today's date).

The report format is freeform markdown. Adapt sections to what you actually found — don't pad with empty sections. A short, sharp report is better than a long, unfocused one.

## What NOT to report

- One-off issues that happened once and resolved themselves
- Things that are working fine (don't pad the report)
- Tool constraints that can't be changed (e.g., "Bash tool has a timeout")
- Vague observations without concrete evidence from sessions or metrics
- Anything that needs fewer than 2 data points to support it
