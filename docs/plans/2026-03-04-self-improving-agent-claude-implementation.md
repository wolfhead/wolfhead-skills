# self-improving-agent-claude Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the ClawHub `pskoett/self-improving-agent` skill to work natively with Claude Code.

**Architecture:** Copy scripts as-is (they're already Claude Code compatible shell hooks). Rewrite SKILL.md to replace all OpenClaw-specific references (SOUL.md, AGENTS.md, TOOLS.md, sessions_send, etc.) with Claude Code equivalents (CLAUDE.md, memory/MEMORY.md). Rewrite hooks-setup.md for Claude Code only.

**Tech Stack:** Bash scripts, Markdown skill files, Claude Code hooks API

**Design doc:** `docs/plans/2026-03-04-self-improving-agent-claude-design.md`

**Source files (on remote):** `ssh meixueting@100.122.191.42` then `~/.openclaw/workspace/skills/self-improving-agent/`

---

### Task 1: Create Directory Structure and Copy Scripts

**Files:**
- Create: `skills/self-improving-agent-claude/scripts/activator.sh`
- Create: `skills/self-improving-agent-claude/scripts/error-detector.sh`
- Create: `skills/self-improving-agent-claude/scripts/extract-skill.sh`

**Step 1: Create directory structure**

Run:
```bash
mkdir -p skills/self-improving-agent-claude/scripts
mkdir -p skills/self-improving-agent-claude/assets
mkdir -p skills/self-improving-agent-claude/references
```

**Step 2: Copy scripts from remote**

Run:
```bash
scp meixueting@100.122.191.42:~/.openclaw/workspace/skills/self-improving-agent/scripts/activator.sh skills/self-improving-agent-claude/scripts/
scp meixueting@100.122.191.42:~/.openclaw/workspace/skills/self-improving-agent/scripts/error-detector.sh skills/self-improving-agent-claude/scripts/
scp meixueting@100.122.191.42:~/.openclaw/workspace/skills/self-improving-agent/scripts/extract-skill.sh skills/self-improving-agent-claude/scripts/
```

**Step 3: Make scripts executable**

Run: `chmod +x skills/self-improving-agent-claude/scripts/*.sh`

**Step 4: Verify scripts copied correctly**

Run: `head -3 skills/self-improving-agent-claude/scripts/*.sh`
Expected: Each file starts with `#!/bin/bash` and a comment header.

**Step 5: Commit**

```bash
git add skills/self-improving-agent-claude/scripts/
git commit -m "feat: add self-improving-agent-claude scripts (copied from ClawHub)"
```

---

### Task 2: Copy Asset Files

**Files:**
- Create: `skills/self-improving-agent-claude/assets/SKILL-TEMPLATE.md`
- Create: `skills/self-improving-agent-claude/assets/LEARNINGS.md`

**Step 1: Copy assets from remote**

Run:
```bash
scp meixueting@100.122.191.42:~/.openclaw/workspace/skills/self-improving-agent/assets/SKILL-TEMPLATE.md skills/self-improving-agent-claude/assets/
scp meixueting@100.122.191.42:~/.openclaw/workspace/skills/self-improving-agent/assets/LEARNINGS.md skills/self-improving-agent-claude/assets/
```

**Step 2: Verify**

Run: `head -5 skills/self-improving-agent-claude/assets/*.md`
Expected: SKILL-TEMPLATE.md starts with `# Skill Template`, LEARNINGS.md starts with `# Learnings`.

**Step 3: Commit**

```bash
git add skills/self-improving-agent-claude/assets/
git commit -m "feat: add self-improving-agent-claude asset templates (copied from ClawHub)"
```

---

### Task 3: Write SKILL.md — Core Skill File

This is the main adaptation work. Rewrite the original SKILL.md replacing all OpenClaw references with Claude Code equivalents.

**Files:**
- Create: `skills/self-improving-agent-claude/SKILL.md`

**Step 1: Read original for reference**

Run: `ssh meixueting@100.122.191.42 'cat ~/.openclaw/workspace/skills/self-improving-agent/SKILL.md'`

**Step 2: Write the adapted SKILL.md**

Create `skills/self-improving-agent-claude/SKILL.md` with these changes from the original:

1. **Frontmatter:** Change name to `self-improving-agent-claude`. Update description to mention Claude Code.

2. **Quick Reference table:** Replace promotion targets:
   - `SOUL.md` → `~/.claude/CLAUDE.md` (global behavioral patterns)
   - `AGENTS.md` → project `CLAUDE.md` (workflow improvements)
   - `TOOLS.md` → project `CLAUDE.md` (tool gotchas)
   - `MEMORY.md` → project `memory/MEMORY.md`

3. **Remove "OpenClaw Setup" section entirely.** Replace with "Claude Code Setup" section:
   - Install: copy skill to `~/.claude/skills/self-improving-agent-claude/`
   - `.learnings/` location: `~/.claude/.learnings/` (global) or `<project-root>/.learnings/` (project)
   - Hook setup: reference `references/hooks-setup.md`

4. **Remove "Inter-Session Communication" section** (sessions_send, sessions_spawn, etc. don't exist in Claude Code).

5. **Rewrite "Workspace Structure" section** to show Claude Code structure:
   ```
   ~/.claude/
   ├── CLAUDE.md                    # Global preferences (always loaded)
   ├── .learnings/                  # Global learnings staging area
   │   ├── LEARNINGS.md
   │   ├── ERRORS.md
   │   └── FEATURE_REQUESTS.md
   ├── settings.json                # Hook configuration
   └── skills/
       └── self-improving-agent-claude/
           └── SKILL.md

   <project-root>/
   ├── CLAUDE.md                    # Project preferences
   ├── .learnings/                  # Project learnings
   │   ├── LEARNINGS.md
   │   ├── ERRORS.md
   │   └── FEATURE_REQUESTS.md
   └── memory/
       └── MEMORY.md                # Project long-term memory
   ```

6. **Rewrite "Promotion Targets" section:**

   | Learning Type | Promote To | When |
   |---------------|------------|------|
   | Cross-project behavioral patterns | `~/.claude/CLAUDE.md` | Applies to all projects |
   | Project conventions/facts | Project `CLAUDE.md` | Specific to one codebase |
   | Workflow improvements | Project `CLAUDE.md` | Project-specific workflows |
   | Tool gotchas | Project `CLAUDE.md` | Tool issues in this project |
   | Long-term memory | Project `memory/MEMORY.md` | Durable facts for this project |

7. **Rewrite "Promotion Decision Tree":**
   ```
   Is the learning project-specific?
   ├── Yes → Promote to project CLAUDE.md or memory/MEMORY.md
   └── No → Is it broadly applicable across all projects?
       ├── Yes → Promote to ~/.claude/CLAUDE.md (global)
       └── No → Keep in .learnings/ until pattern confirmed
   ```

8. **Keep all logging format sections unchanged** (LRN/ERR/FEAT entry templates, ID generation, resolving entries, priority guidelines, area tags).

9. **Keep "Recurring Pattern Detection" section unchanged.**

10. **Keep "Simplify & Harden Feed" section unchanged,** but update promotion targets in the "Promotion Rule" subsection to reference `CLAUDE.md` and `memory/MEMORY.md` instead of SOUL.md/AGENTS.md/TOOLS.md.

11. **Rewrite "Multi-Agent Support" section** — keep only the Claude Code subsection. Remove Codex, Copilot, and OpenClaw subsections.

12. **Keep "Periodic Review" section unchanged.**

13. **Keep "Automatic Skill Extraction" section unchanged** — it's already generic.

14. **Rewrite "Generic Setup" section** to be the primary Claude Code setup (not a fallback).

15. **Update "Hook Integration" section** to reference Claude Code hooks only. Point to `references/hooks-setup.md`.

16. **Remove "Available Hook Events" table** (those are OpenClaw events like `agent:bootstrap`, `command:new`).

17. **Keep "Gitignore Options" unchanged.**

18. **Add "Valid Target Files" note:**
   ```
   Claude Code auto-loads ONLY these files:
   - ~/.claude/CLAUDE.md (global, always loaded)
   - Project CLAUDE.md (project-level)
   - memory/MEMORY.md (first ~200 lines)

   Do NOT promote learnings to other .md files — they won't be loaded.
   ```

**Step 3: Verify SKILL.md has no OpenClaw references**

Run: `grep -i -n "openclaw\|SOUL\.md\|AGENTS\.md\|TOOLS\.md\|sessions_send\|sessions_spawn\|sessions_list\|sessions_history\|clawdhub\|workspace/" skills/self-improving-agent-claude/SKILL.md`
Expected: No matches (or only in the "Source" attribution line).

**Step 4: Commit**

```bash
git add skills/self-improving-agent-claude/SKILL.md
git commit -m "feat: add self-improving-agent-claude SKILL.md adapted for Claude Code"
```

---

### Task 4: Write references/hooks-setup.md

**Files:**
- Create: `skills/self-improving-agent-claude/references/hooks-setup.md`

**Step 1: Read original for reference**

Run: `ssh meixueting@100.122.191.42 'cat ~/.openclaw/workspace/skills/self-improving-agent/references/hooks-setup.md'`

**Step 2: Write hooks-setup.md for Claude Code only**

Keep:
- Claude Code project-level and user-level hook setup sections
- Minimal setup (activator only) section
- Verification section
- Troubleshooting section
- Hook output budget section
- Security considerations
- Disabling hooks section

Remove:
- Codex CLI setup section
- GitHub Copilot setup section
- Any OpenClaw references

Update:
- Script paths to `~/.claude/skills/self-improving-agent-claude/scripts/`
- Settings file to `.claude/settings.json` or `~/.claude/settings.json`

**Step 3: Verify no OpenClaw references**

Run: `grep -i -n "openclaw\|codex\|copilot" skills/self-improving-agent-claude/references/hooks-setup.md`
Expected: No matches.

**Step 4: Commit**

```bash
git add skills/self-improving-agent-claude/references/
git commit -m "feat: add self-improving-agent-claude hooks setup reference"
```

---

### Task 5: Create Global .learnings/ Directory

**Files:**
- Create: `~/.claude/.learnings/LEARNINGS.md`
- Create: `~/.claude/.learnings/ERRORS.md`
- Create: `~/.claude/.learnings/FEATURE_REQUESTS.md`

**Step 1: Create directory and template files**

Run:
```bash
mkdir -p ~/.claude/.learnings
```

**Step 2: Copy templates from assets**

Use the LEARNINGS.md template from the assets directory as the starting content for all three files. Each file gets the appropriate header:

- `LEARNINGS.md` — header from `assets/LEARNINGS.md` (already has correct header)
- `ERRORS.md` — same structure but titled `# Errors`
- `FEATURE_REQUESTS.md` — same structure but titled `# Feature Requests`

**Step 3: Verify**

Run: `ls -la ~/.claude/.learnings/`
Expected: Three `.md` files.

**Step 4: Commit the skill (not the ~/.claude files — those are local config)**

No git commit needed for this step — these are user-local files, not repo files.

---

### Task 6: Verify End-to-End

**Step 1: Verify skill structure**

Run: `find skills/self-improving-agent-claude -type f | sort`
Expected:
```
skills/self-improving-agent-claude/SKILL.md
skills/self-improving-agent-claude/assets/LEARNINGS.md
skills/self-improving-agent-claude/assets/SKILL-TEMPLATE.md
skills/self-improving-agent-claude/references/hooks-setup.md
skills/self-improving-agent-claude/scripts/activator.sh
skills/self-improving-agent-claude/scripts/error-detector.sh
skills/self-improving-agent-claude/scripts/extract-skill.sh
```

**Step 2: Verify no OpenClaw references in skill files**

Run: `grep -r -i "openclaw\|SOUL\.md\|AGENTS\.md\|TOOLS\.md\|sessions_send\|sessions_spawn\|clawdhub" skills/self-improving-agent-claude/ --include="*.md" --include="*.sh"`
Expected: No matches (except possibly a "Source: ported from..." attribution line).

**Step 3: Verify scripts are executable**

Run: `ls -la skills/self-improving-agent-claude/scripts/*.sh`
Expected: All three have executable bit set.

**Step 4: Test activator hook output**

Run: `bash skills/self-improving-agent-claude/scripts/activator.sh`
Expected: Outputs `<self-improvement-reminder>` XML block.

**Step 5: Test error detector with error input**

Run: `CLAUDE_TOOL_OUTPUT="Error: command not found" bash skills/self-improving-agent-claude/scripts/error-detector.sh`
Expected: Outputs `<error-detected>` XML block.

**Step 6: Test error detector with clean input**

Run: `CLAUDE_TOOL_OUTPUT="success" bash skills/self-improving-agent-claude/scripts/error-detector.sh`
Expected: No output (clean exit).

**Step 7: Commit any final fixes**

If any issues found, fix and commit.
