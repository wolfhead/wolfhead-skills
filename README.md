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
| [layered-design](skills/layered-design/) | Runs design discussions with a human decision-maker as dependency-layered decisions: research before each layer's questions, one fully-contextualized decision at a time, case-checked before a layer closes. Replaces unstructured brainstorming. |
| [research-workflow](skills/research-workflow/) | Search-first research with parallel subagent source gathering. Never guess from training data on verifiable questions. |
| [claude-session-analyst](skills/claude-session-analyst/) | Orchestrates multi-session Claude Code transcript analysis. Searches sessions, preprocesses with subsession extraction, dispatches cheap/fast subagents, and synthesizes a unified self-improvement report. |
| [openclaw-session-analyst](skills/openclaw-session-analyst/) | Orchestrates OpenClaw session transcript analysis with cost tracking, model switching detection, and multi-provider support. |
| [session-subagent-analyst](skills/session-subagent-analyst/) | Checklist-driven sub-skill for dispatched analysis subagents. Produces structured JSON reports from condensed session/subsession data. |
| [closing-session](skills/closing-session/) | Triages open questions and unverified claims before a work session ends, so the handoff describes post-triage reality. Run before writing-handoff. |
| [writing-handoff](skills/writing-handoff/) | Writes a handoff doc for a work session that someone (or a future agent) must resume later. |
| [resuming-from-handoff](skills/resuming-from-handoff/) | Verifies a handoff's claims against current reality before resuming work on a project after time away. |

## Adding Skills

Create a folder under `skills/` with a `SKILL.md`:

```
skills/my-skill/
  SKILL.md
```

## License

MIT
