# Wolfhead Skills

AI agent skills for OpenClaw, Claude Code, and other ACP-compatible harnesses.

Skills are markdown-based instructions (SKILL.md) that agents read and adapt to their environment. They work across platforms because they're guidance, not executable code.

## Installation

### OpenClaw

Add this repo as an extra skills directory in `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "load": {
      "extraDirs": ["/path/to/wolfhead_skills/skills"]
    }
  }
}
```

Or copy individual skills into `~/.openclaw/skills/`.

### Claude Code

Copy skill folders into `.claude/skills/` in your project or `~/.claude/skills/` globally.

## Available Skills

| Skill | Description |
|-------|-------------|
| [research-workflow](skills/research-workflow/) | Search-first research with parallel subagent source gathering. Never guess from training data on verifiable questions. |
| [session-analyst](skills/session-analyst/) | Analyzes session transcripts to review skill, agent, and user performance. Produces structured reports with findings, suggestions, and gap analysis. |

## Adding Skills

Create a folder under `skills/` with a `SKILL.md`:

```
skills/my-skill/
  SKILL.md
```

## License

MIT
