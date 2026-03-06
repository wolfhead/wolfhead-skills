---
name: siv
description: "Log learnings via CLI. Use when: user corrects you, command fails, knowledge gap discovered, better approach found."
---

# Self-Improvement

Log learnings with `siv log`. Don't manage files.

## Log

```bash
siv log -c <category> -s "summary" [-d "details"] [-p priority] \
  --project <name> --project-path <path> --session <id>
```

**Categories:** `correction` | `error` | `knowledge_gap` | `best_practice` | `feature_request`

**When to log:**

| Trigger | Category |
|---------|----------|
| User says "that's wrong", "actually..." | `correction` |
| Command returns error / exception | `error` |
| Your knowledge was outdated | `knowledge_gap` |
| Found better way to do something | `best_practice` |
| User wants feature that doesn't exist | `feature_request` |

Analysis and promotion happen offline — just log and continue.
