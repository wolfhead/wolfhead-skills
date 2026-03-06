# Design: self-improving-agent-claude

Port of ClawHub `pskoett/self-improving-agent` (v1.0.11) for Claude Code.

## Source

- ClawHub: https://clawhub.ai/pskoett/self-improving-agent
- GitHub: https://github.com/openclaw/skills/blob/main/skills/pskoett/self-improving-agent/SKILL.md
- Already installed on OpenClaw remote at `~/.openclaw/workspace/skills/self-improving-agent/`

## Goal

Adapt the self-improving-agent skill to work natively with Claude Code's file conventions, skill system, and hook mechanism. OpenClaw continues using the original skill directly.

## Skill Location

- **Install path:** `~/.claude/skills/self-improving-agent-claude/`
- **Global learnings:** `~/.claude/.learnings/` (LEARNINGS.md, ERRORS.md, FEATURE_REQUESTS.md)
- **Project learnings:** `<project-root>/.learnings/` (same as original)

## What Stays the Same

- `scripts/activator.sh` — shell hook, outputs `<self-improvement-reminder>` tag
- `scripts/error-detector.sh` — shell hook, reads `CLAUDE_TOOL_OUTPUT`, outputs `<error-detected>` tag
- `scripts/extract-skill.sh` — pure bash skill scaffolder
- `.learnings/` directory structure and file format
- Entry format: LRN/ERR/FEAT IDs, metadata, status tracking, priority, area tags
- Detection triggers: corrections, errors, knowledge gaps, feature requests
- Recurring pattern detection with Pattern-Key and Recurrence-Count
- Simplify & Harden feed integration

## What Changes

### Removed

| Item | Reason |
|------|--------|
| `hooks/openclaw/handler.ts` | OpenClaw-specific TypeScript HookHandler API |
| Inter-session references (`sessions_send`, `sessions_spawn`, `sessions_list`, `sessions_history`) | Claude Code has no cross-session messaging |
| OpenClaw workspace structure section | Not applicable |
| `clawdhub install` references | Different install mechanism |

### Remapped: Promotion Targets

| Finding type | OpenClaw target | Claude Code target |
|-------------|----------------|-------------------|
| Behavioral patterns | SOUL.md | `~/.claude/CLAUDE.md` (global) |
| Workflow improvements | AGENTS.md | Project `CLAUDE.md` |
| Tool gotchas | TOOLS.md | Project `CLAUDE.md` |
| Project facts/conventions | CLAUDE.md | Project `CLAUDE.md` |
| Long-term memory | MEMORY.md | Project `memory/MEMORY.md` |

### Remapped: Promotion Decision Tree

```
Is the learning project-specific?
├── Yes → Keep in project .learnings/
└── No → Is it broadly applicable across all projects?
    ├── Yes → Promote to ~/.claude/CLAUDE.md (global)
    └── No → Promote to project CLAUDE.md
```

### Updated: Hook Setup

Claude Code hooks go in `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/self-improving-agent-claude/scripts/activator.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/self-improving-agent-claude/scripts/error-detector.sh"
      }]
    }]
  }
}
```

### Updated: .learnings/ Location

- **Global:** `~/.claude/.learnings/` — for cross-project learnings
- **Project:** `<project-root>/.learnings/` — for project-specific learnings
- Skill checks project `.learnings/` first, falls back to global

### Updated: Valid Target Files

Claude Code auto-loads only:
- `~/.claude/CLAUDE.md` — global, always loaded
- `~/.claude/projects/<project-path>/CLAUDE.md` — project-level
- `~/.claude/projects/<project-path>/memory/MEMORY.md` — project-level, first ~200 lines

No other files are auto-loaded. Do NOT write to custom `.md` files that Claude Code won't read.

## Files to Create

```
~/.claude/skills/self-improving-agent-claude/
├── SKILL.md                    # Adapted from original, Claude Code specific
├── scripts/
│   ├── activator.sh            # Copied as-is from original
│   ├── error-detector.sh       # Copied as-is from original
│   └── extract-skill.sh        # Copied as-is from original
├── assets/
│   ├── SKILL-TEMPLATE.md       # Copied as-is
│   └── LEARNINGS.md            # Copied as-is (template header)
└── references/
    ├── hooks-setup.md          # Rewritten for Claude Code only
    └── examples.md             # Copied, adapted examples
```

## What NOT to Change

- Entry format (LRN/ERR/FEAT IDs) — keep compatible with original
- Skill extraction workflow — works the same
- `.learnings/` file format — interoperable with OpenClaw version
- Periodic review workflow
- Priority and area tag system

## Relationship to Existing Skills

- **claude-self-improver**: Reads session analyst reports and auto-applies. Complementary — this skill captures in real-time, self-improver does post-hoc cross-session analysis.
- **claude-session-analyst**: Analyzes session transcripts. Its reports feed into claude-self-improver, not this skill.
- **openclaw-session-analyst**: OpenClaw equivalent. Not related to this port.
