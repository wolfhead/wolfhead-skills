# Session Analyst v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade session-analyst to support multi-session analysis with subsession extraction, session search, and a sub-skill for structured subagent analysis.

**Architecture:** One orchestrator skill (`session-analyst`) dispatches cheap/fast subagents that use a dedicated sub-skill (`session-subagent-analyst`). Two Python scripts handle preprocessing and session discovery. The orchestrator collects all subagent reports and synthesizes one unified self-improvement report.

**Tech Stack:** Python 3 (stdlib only), Claude Code skills (SKILL.md)

---

### Task 1: Add `--output-dir` mode to `extract_session.py`

Upgrade the preprocessor to output main + subsession condensed JSONs to a directory.

**Files:**
- Modify: `skills/session-analyst/scripts/extract_session.py`
- Modify: `skills/session-analyst/scripts/test_extract.py`

**Step 1: Write failing tests for `extract_subsession` and `--output-dir`**

Add to `test_extract.py`:

```python
from extract_session import (
    # ... existing imports ...
    extract_subsession,
    CONTENT_PREVIEW_MAX_CHARS,
)


class TestExtractSubsession(unittest.TestCase):
    def test_basic_subsession(self):
        """extract_subsession should parse a subagent JSONL and return condensed data."""
        with tempfile.TemporaryDirectory() as td:
            records = [
                {
                    "type": "user", "isSidechain": True, "agentId": "ab72d42",
                    "sessionId": "sess-001", "timestamp": "2026-03-04T01:00:00Z",
                    "message": {"role": "user", "content": "Analyze the codebase"},
                },
                {
                    "type": "assistant", "isSidechain": True, "agentId": "ab72d42",
                    "timestamp": "2026-03-04T01:00:05Z",
                    "message": {
                        "model": "claude-haiku-4-5-20251001", "id": "msg_sub1",
                        "content": [{"type": "text", "text": "I'll analyze the codebase."}],
                        "usage": {"input_tokens": 50, "output_tokens": 20,
                                  "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0},
                    },
                },
                {
                    "type": "system", "subtype": "turn_duration",
                    "durationMs": 5000, "timestamp": "2026-03-04T01:00:10Z",
                },
            ]
            path = _write_jsonl(td, "agent-ab72d42.jsonl", records)
            result = extract_subsession(path)
            self.assertIsNotNone(result)
            self.assertEqual(result["metadata"]["session_id"], "sess-001")
            self.assertEqual(len(result["conversation"]), 2)
            self.assertEqual(result["tool_failures"], [])

    def test_nonexistent_file(self):
        """extract_subsession should return None for nonexistent files."""
        result = extract_subsession("/nonexistent/path.jsonl")
        self.assertIsNone(result)


class TestOutputDir(unittest.TestCase):
    def test_output_dir_creates_structure(self):
        """--output-dir should create main.json and subagents/*.json."""
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            session_id = "sess-dir-test"
            # Create main session
            main_records = [
                {
                    "type": "user", "sessionId": session_id, "isSidechain": False,
                    "timestamp": "2026-03-04T01:00:00Z",
                    "message": {"role": "user", "content": "hello"},
                },
                {
                    "type": "assistant", "sessionId": session_id,
                    "timestamp": "2026-03-04T01:00:05Z",
                    "message": {
                        "model": "claude-opus-4-6", "id": "msg_d1",
                        "content": [{"type": "text", "text": "Hi!"}],
                        "usage": {"input_tokens": 10, "output_tokens": 5,
                                  "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0},
                    },
                },
            ]
            session_path = _write_jsonl(td, f"{session_id}.jsonl", main_records)

            # Create subagent directory and file
            sub_dir = os.path.join(td, session_id, "subagents")
            os.makedirs(sub_dir)
            sub_records = [
                {
                    "type": "user", "isSidechain": True, "agentId": "abc123",
                    "sessionId": session_id, "timestamp": "2026-03-04T01:00:02Z",
                    "message": {"role": "user", "content": "sub task"},
                },
            ]
            _write_jsonl(sub_dir, "agent-abc123.jsonl", sub_records)

            # Run with --output-dir
            output_dir = os.path.join(td, "output")
            script_path = os.path.join(os.path.dirname(__file__), "extract_session.py")
            result = subprocess.run(
                [sys.executable, script_path, session_path, "--output-dir", output_dir],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, f"stderr: {result.stderr}")

            # Verify structure
            self.assertTrue(os.path.isfile(os.path.join(output_dir, "main.json")))
            self.assertTrue(os.path.isfile(os.path.join(output_dir, "subagents", "agent-abc123.json")))

            # Verify main.json has subagent_outputs
            with open(os.path.join(output_dir, "main.json")) as f:
                main_data = json.load(f)
            self.assertIn("subagent_outputs", main_data)
            self.assertEqual(len(main_data["subagent_outputs"]), 1)

    def test_output_flag_still_works(self):
        """--output should still work for backward compatibility."""
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            records = [
                {
                    "type": "user", "sessionId": "sess-compat", "isSidechain": False,
                    "timestamp": "2026-03-04T01:00:00Z",
                    "message": {"role": "user", "content": "test"},
                },
            ]
            session_path = _write_jsonl(td, "session.jsonl", records)
            output_path = os.path.join(td, "output.json")
            script_path = os.path.join(os.path.dirname(__file__), "extract_session.py")
            result = subprocess.run(
                [sys.executable, script_path, session_path, "--output", output_path],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, f"stderr: {result.stderr}")
            self.assertTrue(os.path.isfile(output_path))
```

**Step 2: Run tests to verify they fail**

Run: `cd skills/session-analyst && python3 -m pytest scripts/test_extract.py -v -k "TestExtractSubsession or TestOutputDir" 2>&1 | tail -20`
Expected: FAIL — `extract_subsession` and `CONTENT_PREVIEW_MAX_CHARS` not importable

**Step 3: Implement `extract_subsession` and `--output-dir`**

In `extract_session.py`, make these changes:

1. Add named constant at top of file (after imports):

```python
CONTENT_PREVIEW_MAX_CHARS = 500  # Enough context for analysis without bloating output
```

2. Update `_truncate` to use the constant:

```python
def _truncate(text, max_len=CONTENT_PREVIEW_MAX_CHARS):
```

3. Add `extract_subsession` function after `extract_session`:

```python
def extract_subsession(path):
    """Extract condensed data from a subagent JSONL file.

    Same extraction as main session but skips the is_main_session check.
    Returns None if the file doesn't exist or can't be parsed.
    """
    if not os.path.isfile(path):
        return None

    records = parse_jsonl(path)
    if not records:
        return None

    return {
        "metadata": extract_metadata(records),
        "conversation": extract_conversation(records),
        "skills": extract_skills(records),
        "subagents": extract_subagents(records),
        "tool_failures": extract_tool_failures(records),
        "api_errors": extract_api_errors(records),
        "compactions": extract_compactions(records),
    }
```

4. Update `main()` to support `--output-dir`:

```python
def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Extract structured signals from a Claude Code session JSONL file."
    )
    parser.add_argument("session", help="Path to the session JSONL file")
    parser.add_argument(
        "--output", "-o",
        help="Output path for single JSON file (default: stdout)",
        default=None,
    )
    parser.add_argument(
        "--output-dir",
        help="Output directory for main.json + subagents/*.json",
        default=None,
    )
    args = parser.parse_args()

    if not os.path.isfile(args.session):
        print(f"Error: file not found: {args.session}", file=sys.stderr)
        sys.exit(1)

    result = extract_session(args.session)
    if result is None:
        print("Error: not a main session file (subagent or invalid).", file=sys.stderr)
        sys.exit(1)

    if args.output_dir:
        # Directory mode: main.json + subagents/*.json
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        sub_out_dir = out_dir / "subagents"
        sub_out_dir.mkdir(exist_ok=True)

        # Extract subsessions
        subagent_outputs = []
        for sub_path in result.get("subagent_files", []):
            sub_data = extract_subsession(sub_path)
            if sub_data is None:
                continue
            sub_name = Path(sub_path).stem + ".json"  # agent-xxx.json
            sub_out_path = sub_out_dir / sub_name
            with open(sub_out_path, "w", encoding="utf-8") as f:
                json.dump(sub_data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            subagent_outputs.append(str(sub_out_path))

        # Add subagent_outputs to main result
        result["subagent_outputs"] = subagent_outputs

        # Write main.json
        main_path = out_dir / "main.json"
        with open(main_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")

        print(f"Written to {out_dir}/ ({len(subagent_outputs)} subagents)", file=sys.stderr)
    elif args.output:
        # Single file mode (backward compatible)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))
```

**Step 4: Run all tests**

Run: `cd skills/session-analyst && python3 -m pytest scripts/test_extract.py -v 2>&1 | tail -10`
Expected: All tests PASS (58 old + 4 new = 62)

**Step 5: Commit**

```bash
git add skills/session-analyst/scripts/extract_session.py skills/session-analyst/scripts/test_extract.py
git commit -m "feat(session-analyst): add --output-dir mode and extract_subsession for v2"
```

---

### Task 2: Create `search_sessions.py`

New script that searches `~/.claude/projects/` for session files by project, date, and recency.

**Files:**
- Create: `skills/session-analyst/scripts/search_sessions.py`
- Create: `skills/session-analyst/scripts/test_search.py`

**Step 1: Write failing tests**

Create `skills/session-analyst/scripts/test_search.py`:

```python
#!/usr/bin/env python3
"""Tests for search_sessions.py."""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from search_sessions import (
    path_to_project_key,
    count_turns,
    search_sessions,
    MAX_SESSIONS,
    DEFAULT_LATEST,
    DEFAULT_MIN_TURNS,
)


class TestPathToProjectKey(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(
            path_to_project_key("/Users/me/work/myproject"),
            "-Users-me-work-myproject"
        )

    def test_trailing_slash(self):
        self.assertEqual(
            path_to_project_key("/Users/me/work/myproject/"),
            "-Users-me-work-myproject"
        )


class TestCountTurns(unittest.TestCase):
    def test_counts_human_messages(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "test.jsonl")
            with open(path, "w") as f:
                for i in range(5):
                    f.write(json.dumps({"type": "user", "message": {"role": "user", "content": f"msg {i}"}}) + "\n")
                    f.write(json.dumps({"type": "assistant", "message": {"id": f"msg_{i}"}}) + "\n")
            self.assertEqual(count_turns(path), 5)

    def test_skips_tool_results(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "test.jsonl")
            with open(path, "w") as f:
                # Human message
                f.write(json.dumps({"type": "user", "message": {"role": "user", "content": "hello"}}) + "\n")
                # Tool result (list content with tool_result type)
                f.write(json.dumps({"type": "user", "message": {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "ok"}
                ]}}) + "\n")
            self.assertEqual(count_turns(path), 1)

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "empty.jsonl")
            open(path, "w").close()
            self.assertEqual(count_turns(path), 0)


class TestSearchSessions(unittest.TestCase):
    def _setup_project_dir(self, td):
        """Create a fake .claude/projects/<key>/ with session files."""
        project_dir = os.path.join(td, ".claude", "projects", "-Users-me-work-proj")
        os.makedirs(project_dir)

        sessions = []
        for i in range(7):
            sid = f"sess-{i:04d}"
            path = os.path.join(project_dir, f"{sid}.jsonl")
            with open(path, "w") as f:
                # Write enough human turns (4 per session)
                for t in range(4):
                    f.write(json.dumps({"type": "user", "message": {"role": "user", "content": f"turn {t}"}}) + "\n")
                    f.write(json.dumps({"type": "assistant", "message": {"id": f"msg_{t}"}}) + "\n")
            # Stagger mtime so ordering is deterministic
            os.utime(path, (time.time() - (7 - i) * 100, time.time() - (7 - i) * 100))
            sessions.append(path)

        # Add one low-turn session (should be filtered by min_turns=3)
        low_path = os.path.join(project_dir, "sess-low.jsonl")
        with open(low_path, "w") as f:
            f.write(json.dumps({"type": "user", "message": {"role": "user", "content": "hi"}}) + "\n")
        os.utime(low_path, (time.time(), time.time()))

        # Add a subagent directory (should be ignored)
        sub_dir = os.path.join(project_dir, "sess-0001", "subagents")
        os.makedirs(sub_dir)
        sub_path = os.path.join(sub_dir, "agent-abc.jsonl")
        with open(sub_path, "w") as f:
            f.write(json.dumps({"type": "user", "isSidechain": True}) + "\n")

        return project_dir

    @patch.dict(os.environ, {"HOME": ""})
    def test_search_by_project_dir(self):
        with tempfile.TemporaryDirectory() as td:
            project_dir = self._setup_project_dir(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(
                    project_path="/Users/me/work/proj",
                    latest=5,
                    min_turns=3,
                )
            self.assertEqual(len(results), 5)
            # Should be sorted most-recent-first
            for r in results:
                self.assertGreaterEqual(r["turn_count"], 3)

    @patch.dict(os.environ, {"HOME": ""})
    def test_min_turns_filter(self):
        with tempfile.TemporaryDirectory() as td:
            project_dir = self._setup_project_dir(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(
                    project_path="/Users/me/work/proj",
                    latest=100,
                    min_turns=3,
                )
            # The low-turn session should be excluded
            for r in results:
                self.assertGreaterEqual(r["turn_count"], 3)

    @patch.dict(os.environ, {"HOME": ""})
    def test_hard_cap(self):
        with tempfile.TemporaryDirectory() as td:
            # Create more than MAX_SESSIONS files
            project_dir = os.path.join(td, ".claude", "projects", "-Users-me-big")
            os.makedirs(project_dir)
            for i in range(25):
                path = os.path.join(project_dir, f"sess-{i:04d}.jsonl")
                with open(path, "w") as f:
                    for t in range(4):
                        f.write(json.dumps({"type": "user", "message": {"role": "user", "content": f"t{t}"}}) + "\n")
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(
                    project_path="/Users/me/big",
                    latest=100,
                    min_turns=1,
                )
            self.assertLessEqual(len(results), MAX_SESSIONS)

    @patch.dict(os.environ, {"HOME": ""})
    def test_nonexistent_project(self):
        with tempfile.TemporaryDirectory() as td:
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(
                    project_path="/Users/me/nonexistent",
                    latest=5,
                    min_turns=3,
                )
            self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
```

**Step 2: Run tests to verify they fail**

Run: `cd skills/session-analyst && python3 -m pytest scripts/test_search.py -v 2>&1 | tail -10`
Expected: FAIL — `search_sessions` module not found

**Step 3: Implement `search_sessions.py`**

Create `skills/session-analyst/scripts/search_sessions.py`:

```python
#!/usr/bin/env python3
"""Search for Claude Code session files by project, date, and recency.

Searches ~/.claude/projects/ for main session JSONL files.
Filters by project directory, date range, turn count, and recency.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_SESSIONS = 20  # Hard cap to prevent runaway analysis
DEFAULT_LATEST = 5
DEFAULT_MIN_TURNS = 3


def path_to_project_key(project_path):
    """Convert a project directory path to Claude's project key format.

    /Users/me/work/myproject -> -Users-me-work-myproject
    """
    normalized = project_path.rstrip("/")
    return normalized.replace("/", "-")


def count_turns(jsonl_path):
    """Quick-scan a JSONL file to count human message turns.

    Counts records where type="user" and content is a string (not tool_result).
    Reads line-by-line without loading entire file.
    """
    count = 0
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") != "user":
                    continue
                content = rec.get("message", {}).get("content")
                # Skip tool_result records (content is a list with tool_result items)
                if isinstance(content, list):
                    if any(isinstance(item, dict) and item.get("type") == "tool_result" for item in content):
                        continue
                count += 1
    except (OSError, IOError):
        return 0
    return count


def search_sessions(project_path=None, since=None, date=None, latest=DEFAULT_LATEST,
                     min_turns=DEFAULT_MIN_TURNS):
    """Search for session JSONL files matching the given criteria.

    Args:
        project_path: Filter by project directory path (converted to project key).
                      If None, searches all projects.
        since: Only include sessions modified on or after this date (YYYY-MM-DD).
        date: Only include sessions modified on this exact date (YYYY-MM-DD).
        latest: Return at most this many sessions (most recent first).
        min_turns: Exclude sessions with fewer than this many human turns.

    Returns:
        List of dicts sorted by modification time (most recent first):
        [{"path", "session_id", "modified", "size_bytes", "turn_count"}, ...]
    """
    home = os.environ.get("HOME", os.path.expanduser("~"))
    projects_dir = Path(home) / ".claude" / "projects"

    if not projects_dir.is_dir():
        return []

    # Determine which project directories to search
    if project_path:
        key = path_to_project_key(project_path)
        search_dirs = [projects_dir / key]
    else:
        search_dirs = [d for d in projects_dir.iterdir() if d.is_dir()]

    # Collect candidate session files
    candidates = []
    for proj_dir in search_dirs:
        if not proj_dir.is_dir():
            continue
        for f in proj_dir.glob("*.jsonl"):
            # Skip files inside subagent directories
            if "subagents" in f.parts:
                continue
            candidates.append(f)

    # Filter by date
    if since:
        since_dt = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        candidates = [f for f in candidates if datetime.fromtimestamp(
            f.stat().st_mtime, tz=timezone.utc) >= since_dt]

    if date:
        date_dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        date_end = date_dt.replace(hour=23, minute=59, second=59)
        candidates = [f for f in candidates if date_dt <= datetime.fromtimestamp(
            f.stat().st_mtime, tz=timezone.utc) <= date_end]

    # Sort by modification time (most recent first)
    candidates.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    # Build results with turn count filter
    results = []
    for f in candidates:
        if len(results) >= min(latest, MAX_SESSIONS):
            break

        turns = count_turns(str(f))
        if turns < min_turns:
            continue

        stat = f.stat()
        session_id = f.stem  # UUID without .jsonl

        results.append({
            "path": str(f),
            "session_id": session_id,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%S"),
            "size_bytes": stat.st_size,
            "turn_count": turns,
        })

    if len(candidates) > MAX_SESSIONS:
        print(f"Warning: {len(candidates)} sessions found, returning {MAX_SESSIONS} most recent",
              file=sys.stderr)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Search for Claude Code session files."
    )
    parser.add_argument("--project", help="Project directory path to filter by")
    parser.add_argument("--since", help="Only sessions modified on/after this date (YYYY-MM-DD)")
    parser.add_argument("--date", help="Only sessions modified on this date (YYYY-MM-DD)")
    parser.add_argument("--latest", type=int, default=DEFAULT_LATEST,
                        help=f"Max sessions to return (default: {DEFAULT_LATEST}, hard cap: {MAX_SESSIONS})")
    parser.add_argument("--min-turns", type=int, default=DEFAULT_MIN_TURNS,
                        help=f"Min human turns to include (default: {DEFAULT_MIN_TURNS})")
    args = parser.parse_args()

    results = search_sessions(
        project_path=args.project,
        since=args.since,
        date=args.date,
        latest=args.latest,
        min_turns=args.min_turns,
    )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
```

**Step 4: Run tests**

Run: `cd skills/session-analyst && python3 -m pytest scripts/test_search.py -v 2>&1 | tail -15`
Expected: All tests PASS

**Step 5: Run extract tests too (regression)**

Run: `cd skills/session-analyst && python3 -m pytest scripts/ -v 2>&1 | tail -5`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add skills/session-analyst/scripts/search_sessions.py skills/session-analyst/scripts/test_search.py
git commit -m "feat(session-analyst): add search_sessions.py for session discovery"
```

---

### Task 3: Create `session-subagent-analyst` sub-skill

Create the dedicated skill that analysis subagents pick up. Designed for a cheap, fast model with average reasoning ability.

**Files:**
- Create: `skills/session-subagent-analyst/SKILL.md`

**Step 1: Create the skill directory and SKILL.md**

Use the skill-creator skill's init script if available, or create manually.

Create `skills/session-subagent-analyst/SKILL.md`:

```markdown
---
name: session-subagent-analyst
description: "Use when dispatched as a subagent to analyze a Claude Code session or subsession transcript for a performance review. Read the condensed JSON file at the path given in your prompt. Follow the checklist to produce a structured JSON report. Triggers: 'analyze subagent', 'analyze session transcript', 'session performance review subagent'."
---

# Session Subagent Analyst

Analyze one condensed session/subsession JSON file and produce a structured JSON report. Follow the checklist exactly.

## Input

Read the condensed JSON file path from your prompt. The file contains:
- `metadata` — session ID, slug, model, tokens, turn durations
- `conversation` — human messages, assistant turns, tool results
- `skills` — skill invocations with name, args, result
- `subagents` — nested subagent invocations (may be empty for subsessions)
- `tool_failures` — tool results with `is_error: true`
- `api_errors` — API errors with retry info
- `compactions` — context compaction events

## Determine Analysis Type

Check the file path or metadata to determine type:
- **Main session** (`main.json` or no `agentId` in records): Use the Main Session Checklist
- **Subsession** (`subagents/*.json` or `agentId` present): Use the Subsession Checklist

## Main Session Checklist

Check each item. Only report findings — skip items with nothing notable.

- [ ] **Skill timing**: Were skills invoked at the right time? Too early (before enough context)? Too late (after user already decided)? Missed entirely?
- [ ] **Skill arguments**: Were skill invocations given good arguments? Too verbose? Missing context?
- [ ] **User corrections**: Did the user correct the agent? How many times? What pattern?
- [ ] **Rejected interactions**: Were any AskUserQuestion or tool calls rejected by the user? What does this suggest?
- [ ] **Flow efficiency**: How many turns? Were subagents spawned unnecessarily (task could have been a direct tool call)? Token usage proportional to task complexity?
- [ ] **Gaps**: Were there situations where a skill or agent specialization was clearly missing?

## Subsession Checklist

Check each item. Only report findings — skip items with nothing notable.

- [ ] **Task completion**: Did the subagent accomplish what it was asked to do? Check the first human message (the task) against the final output.
- [ ] **Doom loop**: Are there 3+ consecutive identical or near-identical tool calls with the same error? Flag with the tool name and error.
- [ ] **Redundant operations**: Same file read multiple times? Overlapping search queries? Sequential operations that could be parallel?
- [ ] **Tool failures**: List each `is_error: true` result. Did the subagent recover or get stuck?
- [ ] **Skill compliance**: If a skill was invoked, did the subagent follow its documented steps? "deviated" = skipped steps or ignored instructions.
- [ ] **Token efficiency**: Compare output tokens to task complexity. Flag if output seems 5x+ more than the task warrants (e.g., simple lookup generating 10k tokens).

## Output Format

Output ONLY this JSON (no other text):

```json
{
  "analysis_type": "main_session|subsession",
  "file_analyzed": "<path to the file you read>",
  "skill_suggestions": [
    {
      "skill_name": "<name>",
      "caller_suggestion": "<how the caller could use it better, or null>",
      "skill_suggestion": "<how the skill itself could improve, or null>"
    }
  ],
  "anti_patterns": [
    {
      "pattern": "<short name>",
      "description": "<what happened>",
      "impact": "<time/tokens/failures cost>"
    }
  ],
  "user_preferences": [
    {
      "preference": "<detected pattern>",
      "scope": "global|project",
      "evidence": "<what you observed>"
    }
  ],
  "gaps": [
    {
      "description": "<situation where a skill or specialization was missing>",
      "proposed_skill": "<suggested name and brief description>"
    }
  ]
}
```

**Field rules:**
- Omit empty arrays (if no anti_patterns found, don't include the key)
- `skill_suggestions`: only include if there are actual non-trivial suggestions. "Skill worked fine" is not a suggestion.
- `anti_patterns`: concrete patterns only. "Agent used Read" is not an anti-pattern. "Agent read the same 500-line file 4 times in one turn" is.
- `user_preferences`: only include if evidence appears 2+ times in the session. One correction is not a preference.
- `gaps`: only include if there was a clear situation where a skill would have helped and none exists.

## Example

Input: A subsession where a subagent was asked to "Research Claude Code session format" and made 3 sequential WebSearch calls followed by 3 sequential WebFetch calls.

Output:
```json
{
  "analysis_type": "subsession",
  "file_analyzed": "/tmp/session-analyst/sess-001/subagents/agent-abc123.json",
  "anti_patterns": [
    {
      "pattern": "Sequential web research",
      "description": "3 WebSearch calls followed by 3 WebFetch calls executed sequentially. All searches were independent and could have been dispatched in parallel.",
      "impact": "Added ~45s wall-clock time. Parallel execution would reduce to ~15s."
    }
  ]
}
```

Note: no `skill_suggestions`, `user_preferences`, or `gaps` keys because none were found.
```

**Step 2: Validate the skill**

Run: `python3 ~/.claude/skills/skill-creator/scripts/quick_validate.py skills/session-subagent-analyst/`
Expected: "Skill is valid!"

**Step 3: Symlink the skill**

```bash
ln -sf "$(pwd)/skills/session-subagent-analyst" ~/.claude/skills/session-subagent-analyst
```

**Step 4: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "feat: add session-subagent-analyst sub-skill for structured analysis"
```

---

### Task 4: Update `session-analyst` SKILL.md

Rewrite the orchestrator SKILL.md with the new workflow, report format, and best practices fixes.

**Files:**
- Modify: `skills/session-analyst/SKILL.md`

**Step 1: Rewrite SKILL.md**

Replace the entire content of `skills/session-analyst/SKILL.md` with:

```markdown
---
name: session-analyst
description: "Use when the user wants to review past sessions, analyze skill performance, identify missing skills, detect user preferences, or improve agent workflows. Triggers: 'review session', 'review sessions', 'analyze session', 'what went well', 'session review', 'how did that go', 'improve skills', 'session summary', 'what happened', 'retrospective', 'debrief'."
---

# Session Analyst

Orchestrate session transcript analysis to produce a self-improvement report. Dispatch cheap/fast subagents for analysis work, then synthesize their findings into one unified report.

Does NOT modify skill files — observe, analyze, and report only.

## Process

- [ ] 1. Search for sessions
- [ ] 2. Preprocess each session
- [ ] 3. Dispatch analysis subagents
- [ ] 4. Synthesize report

### 1. Search for Sessions

Determine target sessions from user input. Use the bundled search script:

```bash
python3 <skill-dir>/scripts/search_sessions.py --project "$PWD" --latest 5 --min-turns 3
```

Where `<skill-dir>` is the directory containing this SKILL.md (resolve via the skill's installation path).

**Argument mapping:**
- "review this session" / "last session" → `--latest 1`
- "review last N sessions" → `--latest N`
- "review today's sessions" → `--date YYYY-MM-DD`
- "review sessions since Monday" → `--since YYYY-MM-DD`
- No argument → `--latest 5` (default)

The script returns a JSON array of session objects with `path`, `session_id`, `modified`, `size_bytes`, and `turn_count`.

### 2. Preprocess Each Session

For each session path from step 1, extract condensed data:

```bash
python3 <skill-dir>/scripts/extract_session.py <session.jsonl> --output-dir /tmp/session-analyst/<session-id>/
```

This creates:
```
/tmp/session-analyst/<session-id>/
├── main.json              # Main session condensed data
├── subagents/
│   ├── agent-xxx.json     # Condensed subsession data
│   └── ...
```

### 3. Dispatch Analysis Subagents

For each condensed JSON file (both `main.json` and every `subagents/*.json`), dispatch one subagent using a cheap, fast model with average reasoning ability:

```
Agent tool (model: cheap/fast):
  description: "Analyze <main|subagent> <session-id>"
  prompt: |
    Analyze the session transcript at: <path to condensed JSON file>

    Context: This is part of a multi-session performance review.
    Parent session slug: <slug from metadata>

    Use the session-subagent-analyst skill to guide your analysis.
    Output only the JSON report.
```

Dispatch all subagents in parallel. Collect all JSON reports.

### 4. Synthesize Report

Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `docs/reviews/YYYY-MM-DD-sessions-review.md` (create directory if needed).

**Merge rules:**
- **Skill Suggestions**: Group by skill name. Deduplicate similar suggestions. Note frequency.
- **Anti-patterns**: Group by pattern name. Count occurrences across sessions.
- **User Preferences**: Only promote to the report if observed in 2+ sessions (single-session observations are noise).
- **Gaps**: Deduplicate. Note frequency.

## Report Template

```markdown
# Session Analysis Report
**Date**: YYYY-MM-DD | **Sessions analyzed**: N
**Session list**: <slug-1>, <slug-2>, ...

---

## 1. Skill Suggestions

### <skill-name>
**Observed in**: <N> sessions
**Caller suggestions**: <how invoker could use skill better>
**Skill suggestions**: <non-trivial improvements to the skill itself>

(Omit skill if no suggestions. Omit Caller/Skill suggestions subsection if empty.)

---

## 2. Anti-patterns

**<pattern-name>**: <description of recurring inefficiency>
- Observed in: <N>/<total> sessions
- Impact: <what it costs — time, tokens, failures>
- Recommendation: <how to fix>

(Omit entire section if none found.)

---

## 3. User Preferences

| Preference | Scope | Frequency | Suggested Entry |
|-----------|-------|-----------|----------------|
| <pattern> | Global/Project | <N>/<total> sessions | <what to add to CLAUDE.md or memory> |

(Omit entire section if none found.)

---

## 4. Gaps

**<gap-name>**: <situation where a skill or specialization was missing>
- Observed in: <N>/<total> sessions
- Proposed skill: <name and brief description>

(Omit entire section if none found.)
```

## Quality Standards

- **Non-trivial only.** Skip obvious observations like "agent used Read to read a file."
- **Be specific.** "Brainstorming skill invoked after user had already decided" > "skill could improve."
- **Caller matters.** Often the issue is invocation (timing, args) not the skill itself.
- **Cross-session patterns matter most.** Single-session findings are less actionable than patterns appearing in 3+ sessions.
- **Token awareness.** Flag subagents using 5x+ expected tokens for their task.
```

**Step 2: Validate the skill**

Run: `python3 ~/.claude/skills/skill-creator/scripts/quick_validate.py skills/session-analyst/`
Expected: "Skill is valid!"

**Step 3: Commit**

```bash
git add skills/session-analyst/SKILL.md
git commit -m "feat(session-analyst): rewrite SKILL.md as v2 orchestrator with new report format"
```

---

### Task 5: Integration test — run full workflow on real sessions

End-to-end test of the complete v2 pipeline on real session data.

**Files:**
- No new files — this is a manual verification task

**Step 1: Run search**

```bash
cd /Users/meixueting/work/wolfhead_skills
python3 skills/session-analyst/scripts/search_sessions.py --project "$PWD" --latest 2 --min-turns 3
```

Expected: JSON array with 1-2 session entries from this project.

**Step 2: Run preprocessor with --output-dir**

```bash
python3 skills/session-analyst/scripts/extract_session.py <session.jsonl from step 1> \
  --output-dir /tmp/session-analyst/<session-id>/
```

Expected: Directory created with `main.json` and `subagents/*.json` files. Verify:
```bash
ls -la /tmp/session-analyst/<session-id>/
ls -la /tmp/session-analyst/<session-id>/subagents/
```

**Step 3: Verify condensed subsession JSON is readable**

```bash
python3 -c "import json; d=json.load(open('/tmp/session-analyst/<session-id>/subagents/<first-agent>.json')); print(len(d['conversation']), 'turns,', len(d['tool_failures']), 'failures')"
```

Expected: Reasonable numbers (not zero unless it's a very simple subagent).

**Step 4: Test dispatch a single analysis subagent**

Dispatch one subagent manually using the Agent tool with the session-subagent-analyst skill to verify it produces valid JSON output. Use a cheap/fast model.

**Step 5: Commit integration test results**

If the pipeline worked, no code changes needed. If issues found, fix and commit.

---

### Task 6: Update README

Update the skills table in README.md to reflect the v2 changes and the new sub-skill.

**Files:**
- Modify: `README.md`

**Step 1: Read current README**

Read `README.md` to find the skills table.

**Step 2: Update the table**

Update the `session-analyst` row to reflect the v2 capabilities. Add a row for `session-subagent-analyst`.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for session-analyst v2 and sub-skill"
```
