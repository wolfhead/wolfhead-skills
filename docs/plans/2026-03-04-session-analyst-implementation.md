# Session Analyst Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `session-analyst` skill that reads Claude Code session transcripts, analyzes skill/agent/user performance via fan-out subagents, and produces a structured review report.

**Architecture:** Python preprocessor (`extract_session.py`) parses raw JSONL into condensed JSON. SKILL.md instructs the agent to run the preprocessor, fan out analysis subagents per subagent transcript, synthesize findings, and write a 4-section markdown report.

**Tech Stack:** Python 3 (stdlib only: json, os, sys, glob, datetime, re, pathlib), Markdown SKILL.md

**Reference docs:**
- Design: `docs/plans/2026-03-04-session-analyst-design.md`
- JSONL format: `docs/claude-code-session-format.md`
- Existing skill example: `skills/research-workflow/SKILL.md`

---

### Task 1: Create Skill Directory Structure

**Files:**
- Create: `skills/session-analyst/SKILL.md` (placeholder)
- Create: `skills/session-analyst/extract_session.py` (placeholder)

**Step 1: Create the skill directory and placeholder files**

```bash
mkdir -p skills/session-analyst
touch skills/session-analyst/SKILL.md
touch skills/session-analyst/extract_session.py
```

**Step 2: Commit**

```bash
git add skills/session-analyst/
git commit -m "chore: scaffold session-analyst skill directory"
```

---

### Task 2: Python Preprocessor — JSONL Parser Core

**Files:**
- Create: `skills/session-analyst/extract_session.py`
- Create: `skills/session-analyst/test_extract.py`

This task builds the core JSONL parsing and record classification logic.

**Step 1: Write the failing test**

Create `skills/session-analyst/test_extract.py`:

```python
"""Tests for extract_session.py JSONL parser."""
import json
import os
import sys
import tempfile

# Add skill dir to path
sys.path.insert(0, os.path.dirname(__file__))
from extract_session import parse_jsonl, classify_record, is_main_session


def _write_jsonl(records):
    """Write records to a temp JSONL file, return path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
    for r in records:
        f.write(json.dumps(r) + "\n")
    f.close()
    return f.name


def test_parse_jsonl_reads_all_lines():
    records = [
        {"type": "user", "uuid": "aaa", "message": {"role": "user", "content": "hello"}},
        {"type": "assistant", "uuid": "bbb", "message": {"role": "assistant", "content": [{"type": "text", "text": "hi"}]}},
    ]
    path = _write_jsonl(records)
    try:
        result = parse_jsonl(path)
        assert len(result) == 2
        assert result[0]["type"] == "user"
        assert result[1]["type"] == "assistant"
    finally:
        os.unlink(path)


def test_classify_record_types():
    assert classify_record({"type": "user", "message": {"role": "user", "content": "hello"}}) == "human_message"
    assert classify_record({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result"}]}}) == "tool_result"
    assert classify_record({"type": "assistant"}) == "assistant"
    assert classify_record({"type": "progress", "data": {"type": "agent_progress"}}) == "agent_progress"
    assert classify_record({"type": "progress", "data": {"type": "bash_progress"}}) == "bash_progress"
    assert classify_record({"type": "system", "subtype": "turn_duration"}) == "turn_duration"
    assert classify_record({"type": "system", "subtype": "api_error"}) == "api_error"
    assert classify_record({"type": "system", "subtype": "compact_boundary"}) == "compact_boundary"
    assert classify_record({"type": "file-history-snapshot"}) == "skip"
    assert classify_record({"type": "saved_hook_context"}) == "skip"
    assert classify_record({"type": "summary"}) == "summary"


def test_is_main_session_true():
    records = [
        {"type": "user", "isSidechain": False, "message": {"role": "user", "content": "hello"}},
    ]
    path = _write_jsonl(records)
    try:
        assert is_main_session(path) is True
    finally:
        os.unlink(path)


def test_is_main_session_false_for_subagent():
    records = [
        {"type": "user", "isSidechain": True, "agentId": "abc123", "message": {"role": "user", "content": "task prompt"}},
    ]
    path = _write_jsonl(records)
    try:
        assert is_main_session(path) is False
    finally:
        os.unlink(path)


if __name__ == "__main__":
    test_parse_jsonl_reads_all_lines()
    test_classify_record_types()
    test_is_main_session_true()
    test_is_main_session_false_for_subagent()
    print("All tests passed.")
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/meixueting/work/wolfhead_skills && python3 skills/session-analyst/test_extract.py`
Expected: ImportError — `extract_session` has no `parse_jsonl`, `classify_record`, `is_main_session`.

**Step 3: Write minimal implementation**

Create `skills/session-analyst/extract_session.py`:

```python
#!/usr/bin/env python3
"""
Extract relevant signals from Claude Code session JSONL files.

Reads raw JSONL and outputs condensed JSON with:
- Session metadata
- Conversation flow (text only, no thinking blocks)
- Skills invoked
- Subagent map
- Tool failures
- User corrections
- System errors
- Turn durations
- Compaction events

Usage:
    python3 extract_session.py <session.jsonl> [--output <path>]

Reference: docs/claude-code-session-format.md
"""
import json
import os
import sys


def parse_jsonl(path):
    """Parse a JSONL file into a list of dicts. Skips blank/malformed lines."""
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                # Skip malformed lines, log to stderr
                print(f"Warning: skipping malformed JSON at line {line_num}", file=sys.stderr)
    return records


def classify_record(record):
    """Classify a JSONL record into a semantic category for extraction.

    Returns one of:
        human_message, tool_result, assistant, agent_progress, bash_progress,
        hook_progress, turn_duration, api_error, compact_boundary, summary,
        queue_operation, skip
    """
    rtype = record.get("type", "")

    if rtype == "user":
        msg = record.get("message", {})
        content = msg.get("content")
        if isinstance(content, list) and content and isinstance(content[0], dict) and content[0].get("type") == "tool_result":
            return "tool_result"
        return "human_message"

    if rtype == "assistant":
        return "assistant"

    if rtype == "progress":
        data = record.get("data", {})
        dtype = data.get("type", "")
        if dtype == "agent_progress":
            return "agent_progress"
        if dtype == "bash_progress":
            return "bash_progress"
        if dtype == "hook_progress":
            return "hook_progress"
        return "progress_other"

    if rtype == "system":
        subtype = record.get("subtype", "")
        if subtype == "turn_duration":
            return "turn_duration"
        if subtype == "api_error":
            return "api_error"
        if subtype == "compact_boundary":
            return "compact_boundary"
        if subtype == "stop_hook_summary":
            return "stop_hook_summary"
        if subtype == "local_command":
            return "local_command"
        return "system_other"

    if rtype == "summary":
        return "summary"

    if rtype == "queue-operation":
        return "queue_operation"

    # file-history-snapshot, saved_hook_context — not needed for analysis
    return "skip"


def is_main_session(path):
    """Check if a JSONL file is a main session (not a subagent).

    Reads the first non-skip record. If isSidechain is True or agentId
    is present, it's a subagent file.
    """
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Skip records that don't have isSidechain field
            if "isSidechain" not in record and "agentId" not in record:
                continue
            if record.get("isSidechain") is True or record.get("agentId"):
                return False
            return True
    # If no records found with these fields, assume main session
    return True
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/meixueting/work/wolfhead_skills && python3 skills/session-analyst/test_extract.py`
Expected: `All tests passed.`

**Step 5: Commit**

```bash
git add skills/session-analyst/extract_session.py skills/session-analyst/test_extract.py
git commit -m "feat(session-analyst): add JSONL parser core with record classification"
```

---

### Task 3: Python Preprocessor — Metadata Extraction

**Files:**
- Modify: `skills/session-analyst/extract_session.py`
- Modify: `skills/session-analyst/test_extract.py`

Extract session metadata: ID, slug, project path, timestamps, duration, model, CLI version.

**Step 1: Write the failing test**

Append to `test_extract.py`:

```python
def test_extract_metadata():
    records = [
        {
            "type": "user", "uuid": "aaa", "parentUuid": None,
            "sessionId": "sess-001", "timestamp": "2026-03-04T10:00:00.000Z",
            "isSidechain": False, "cwd": "/Users/me/work/project",
            "gitBranch": "main", "version": "2.1.37",
            "message": {"role": "user", "content": "hello"}
        },
        {
            "type": "assistant", "uuid": "bbb", "parentUuid": "aaa",
            "sessionId": "sess-001", "timestamp": "2026-03-04T10:00:05.000Z",
            "slug": "happy-coding-cat", "version": "2.1.37",
            "message": {
                "model": "claude-opus-4-6", "id": "msg_001",
                "role": "assistant",
                "content": [{"type": "text", "text": "Hi!"}],
                "usage": {"input_tokens": 100, "output_tokens": 20}
            }
        },
        {
            "type": "system", "subtype": "turn_duration",
            "uuid": "ccc", "parentUuid": "bbb",
            "sessionId": "sess-001", "timestamp": "2026-03-04T10:00:10.000Z",
            "durationMs": 10000
        },
    ]
    path = _write_jsonl(records)
    try:
        from extract_session import extract_metadata
        meta = extract_metadata(records)
        assert meta["session_id"] == "sess-001"
        assert meta["slug"] == "happy-coding-cat"
        assert meta["cwd"] == "/Users/me/work/project"
        assert meta["model"] == "claude-opus-4-6"
        assert meta["version"] == "2.1.37"
        assert meta["git_branch"] == "main"
        assert meta["first_timestamp"] == "2026-03-04T10:00:00.000Z"
        assert meta["last_timestamp"] == "2026-03-04T10:00:10.000Z"
    finally:
        os.unlink(path)
```

**Step 2: Run test to verify it fails**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: ImportError — no `extract_metadata`.

**Step 3: Write implementation**

Add to `extract_session.py`:

```python
def extract_metadata(records):
    """Extract session metadata from parsed records.

    Returns dict with: session_id, slug, cwd, git_branch, model, version,
    first_timestamp, last_timestamp, total_input_tokens, total_output_tokens,
    total_cache_read_tokens, total_cache_creation_tokens, turn_count, turn_durations.
    """
    meta = {
        "session_id": None,
        "slug": None,
        "cwd": None,
        "git_branch": None,
        "model": None,
        "version": None,
        "first_timestamp": None,
        "last_timestamp": None,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_cache_read_tokens": 0,
        "total_cache_creation_tokens": 0,
        "turn_count": 0,
        "turn_durations": [],
    }

    for r in records:
        ts = r.get("timestamp")
        if ts:
            if meta["first_timestamp"] is None:
                meta["first_timestamp"] = ts
            meta["last_timestamp"] = ts

        if not meta["session_id"] and r.get("sessionId"):
            meta["session_id"] = r["sessionId"]
        if not meta["slug"] and r.get("slug"):
            meta["slug"] = r["slug"]
        if not meta["cwd"] and r.get("cwd"):
            meta["cwd"] = r["cwd"]
        if not meta["git_branch"] and r.get("gitBranch"):
            meta["git_branch"] = r["gitBranch"]
        if not meta["version"] and r.get("version"):
            meta["version"] = r["version"]

        # Extract model and token usage from assistant records
        if r.get("type") == "assistant":
            msg = r.get("message", {})
            if not meta["model"] and msg.get("model"):
                meta["model"] = msg["model"]
            usage = msg.get("usage", {})
            meta["total_input_tokens"] += usage.get("input_tokens", 0)
            meta["total_output_tokens"] += usage.get("output_tokens", 0)
            meta["total_cache_read_tokens"] += usage.get("cache_read_input_tokens", 0)
            meta["total_cache_creation_tokens"] += usage.get("cache_creation_input_tokens", 0)

        # Extract turn durations
        if r.get("type") == "system" and r.get("subtype") == "turn_duration":
            meta["turn_durations"].append(r.get("durationMs", 0))
            meta["turn_count"] += 1

    return meta
```

**Step 4: Run test to verify it passes**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: `All tests passed.`

**Step 5: Commit**

```bash
git add skills/session-analyst/extract_session.py skills/session-analyst/test_extract.py
git commit -m "feat(session-analyst): add session metadata extraction"
```

---

### Task 4: Python Preprocessor — Conversation Flow Extraction

**Files:**
- Modify: `skills/session-analyst/extract_session.py`
- Modify: `skills/session-analyst/test_extract.py`

Extract the conversation as a sequence of turns: user messages (text), assistant responses (text only, skip thinking), tool calls, tool results.

**Step 1: Write the failing test**

Append to `test_extract.py`:

```python
def test_extract_conversation():
    records = [
        {
            "type": "user", "uuid": "u1", "parentUuid": None,
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:00.000Z",
            "isSidechain": False,
            "message": {"role": "user", "content": "Fix the bug in auth.py"}
        },
        {
            "type": "assistant", "uuid": "a1", "parentUuid": "u1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:01.000Z",
            "message": {
                "id": "msg_001", "role": "assistant",
                "content": [{"type": "thinking", "thinking": "Let me think..."}],
                "usage": {}
            }
        },
        {
            "type": "assistant", "uuid": "a2", "parentUuid": "a1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:02.000Z",
            "message": {
                "id": "msg_001", "role": "assistant",
                "content": [{"type": "text", "text": "I'll read the file first."}],
                "usage": {}
            }
        },
        {
            "type": "assistant", "uuid": "a3", "parentUuid": "a2",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:03.000Z",
            "message": {
                "id": "msg_001", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_001", "name": "Read", "input": {"file_path": "/app/auth.py"}}],
                "usage": {}
            }
        },
        {
            "type": "user", "uuid": "tr1", "parentUuid": "a3",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:04.000Z",
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "toolu_001", "content": "def login():\n    pass", "is_error": False}]
            }
        },
    ]
    path = _write_jsonl(records)
    try:
        from extract_session import extract_conversation
        convo = extract_conversation(records)
        # Should have: 1 human message, 1 merged assistant turn (text + tool_use), 1 tool result
        assert len(convo) == 3
        assert convo[0]["type"] == "human_message"
        assert convo[0]["content"] == "Fix the bug in auth.py"
        assert convo[1]["type"] == "assistant_turn"
        assert convo[1]["text"] == "I'll read the file first."
        assert len(convo[1]["tool_calls"]) == 1
        assert convo[1]["tool_calls"][0]["name"] == "Read"
        # Thinking should be excluded from text
        assert "Let me think" not in convo[1]["text"]
        assert convo[2]["type"] == "tool_result"
        assert convo[2]["tool_name"] == "Read"
        assert convo[2]["is_error"] is False
    finally:
        os.unlink(path)
```

**Step 2: Run test to verify it fails**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: ImportError — no `extract_conversation`.

**Step 3: Write implementation**

Add to `extract_session.py`:

```python
def extract_conversation(records):
    """Extract conversation as a list of turns.

    Groups streamed assistant records (same message.id) into single turns.
    Skips thinking blocks. Extracts tool calls and tool results.

    Returns list of dicts, each one of:
    - {"type": "human_message", "content": str, "timestamp": str, "uuid": str}
    - {"type": "assistant_turn", "text": str, "tool_calls": [...], "timestamp": str, "message_id": str}
    - {"type": "tool_result", "tool_use_id": str, "tool_name": str, "content_preview": str, "is_error": bool, "timestamp": str}
    """
    conversation = []
    # Build a map of tool_use_id -> tool_name from assistant records
    tool_name_map = {}

    # First pass: collect tool names
    for r in records:
        if r.get("type") == "assistant":
            for block in r.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_name_map[block["id"]] = block.get("name", "unknown")

    # Second pass: build conversation
    # Group assistant records by message.id
    assistant_groups = {}
    assistant_order = []

    for r in records:
        cat = classify_record(r)

        if cat == "human_message":
            conversation.append({
                "type": "human_message",
                "content": r.get("message", {}).get("content", ""),
                "timestamp": r.get("timestamp", ""),
                "uuid": r.get("uuid", ""),
            })

        elif cat == "assistant":
            msg = r.get("message", {})
            msg_id = msg.get("id", r.get("uuid", ""))
            if msg_id not in assistant_groups:
                assistant_groups[msg_id] = {
                    "type": "assistant_turn",
                    "text": "",
                    "tool_calls": [],
                    "timestamp": r.get("timestamp", ""),
                    "message_id": msg_id,
                }
                assistant_order.append(("assistant", msg_id))

            group = assistant_groups[msg_id]
            for block in msg.get("content", []):
                if not isinstance(block, dict):
                    continue
                btype = block.get("type", "")
                if btype == "text":
                    text = block.get("text", "").strip()
                    if text:
                        if group["text"]:
                            group["text"] += "\n" + text
                        else:
                            group["text"] = text
                elif btype == "tool_use":
                    group["tool_calls"].append({
                        "id": block.get("id", ""),
                        "name": block.get("name", "unknown"),
                        "input": block.get("input", {}),
                    })

        elif cat == "tool_result":
            msg = r.get("message", {})
            for item in msg.get("content", []):
                if isinstance(item, dict) and item.get("type") == "tool_result":
                    tool_use_id = item.get("tool_use_id", "")
                    raw_content = item.get("content", "")
                    # Truncate long tool results for the condensed output
                    if isinstance(raw_content, list):
                        content_preview = " ".join(
                            t.get("text", "") for t in raw_content if isinstance(t, dict)
                        )[:500]
                    elif isinstance(raw_content, str):
                        content_preview = raw_content[:500]
                    else:
                        content_preview = str(raw_content)[:500]

                    conversation.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "tool_name": tool_name_map.get(tool_use_id, "unknown"),
                        "content_preview": content_preview,
                        "is_error": item.get("is_error", False),
                        "timestamp": r.get("timestamp", ""),
                    })

    # Now interleave assistant turns at correct positions
    # Rebuild conversation with assistant turns in order
    final = []
    assistant_iter = iter(assistant_order)
    next_assistant = next(assistant_iter, None)

    for entry in conversation:
        # Insert any assistant turns that came before this entry
        # (based on timestamp ordering — records are chronological in JSONL)
        while next_assistant and next_assistant[0] == "assistant":
            a_group = assistant_groups[next_assistant[1]]
            if a_group["timestamp"] <= entry["timestamp"]:
                final.append(a_group)
                next_assistant = next(assistant_iter, None)
            else:
                break
        final.append(entry)

    # Append remaining assistant turns
    while next_assistant:
        if next_assistant[0] == "assistant":
            final.append(assistant_groups[next_assistant[1]])
        next_assistant = next(assistant_iter, None)

    return final
```

**Step 4: Run test to verify it passes**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: `All tests passed.`

**Step 5: Commit**

```bash
git add skills/session-analyst/extract_session.py skills/session-analyst/test_extract.py
git commit -m "feat(session-analyst): add conversation flow extraction with assistant grouping"
```

---

### Task 5: Python Preprocessor — Skills, Subagents, Failures, Errors

**Files:**
- Modify: `skills/session-analyst/extract_session.py`
- Modify: `skills/session-analyst/test_extract.py`

Extract skills invoked, subagent map, tool failures, API errors, and compaction events.

**Step 1: Write the failing test**

Append to `test_extract.py`:

```python
def test_extract_skills():
    records = [
        {
            "type": "assistant", "uuid": "a1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:00.000Z",
            "message": {
                "id": "msg_001", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_sk1", "name": "Skill", "input": {"skill": "superpowers:brainstorming", "args": "design the feature"}}],
                "usage": {}
            }
        },
        {
            "type": "user", "uuid": "tr1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:01.000Z",
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_sk1", "content": "Skill loaded successfully"}]}
        },
    ]
    from extract_session import extract_skills
    skills = extract_skills(records)
    assert len(skills) == 1
    assert skills[0]["skill_name"] == "superpowers:brainstorming"
    assert skills[0]["args"] == "design the feature"


def test_extract_subagents():
    records = [
        {
            "type": "assistant", "uuid": "a1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:00.000Z",
            "message": {
                "id": "msg_001", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_t1", "name": "Task", "input": {"description": "Explore codebase", "prompt": "Look at...", "subagent_type": "Explore"}}],
                "usage": {}
            }
        },
        {
            "type": "user", "uuid": "tr1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:01:00.000Z",
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_t1", "content": [{"type": "text", "text": "Found 5 files"}, {"type": "text", "text": "agentId: abc123\n<usage>total_tokens: 5000\ntool_uses: 3\nduration_ms: 30000</usage>"}]}]},
            "toolUseResult": {"status": "completed", "prompt": "Look at..."}
        },
    ]
    from extract_session import extract_subagents
    subs = extract_subagents(records)
    assert len(subs) == 1
    assert subs[0]["description"] == "Explore codebase"
    assert subs[0]["subagent_type"] == "Explore"
    assert subs[0]["agent_id"] == "abc123"
    assert subs[0]["status"] == "completed"


def test_extract_tool_failures():
    records = [
        {
            "type": "assistant", "uuid": "a1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:00.000Z",
            "message": {
                "id": "msg_001", "role": "assistant",
                "content": [{"type": "tool_use", "id": "toolu_f1", "name": "Read", "input": {"file_path": "/missing.py"}}],
                "usage": {}
            }
        },
        {
            "type": "user", "uuid": "tr1",
            "sessionId": "s1", "timestamp": "2026-03-04T10:00:01.000Z",
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_f1", "content": "<tool_use_error>File does not exist.</tool_use_error>", "is_error": True}]}
        },
    ]
    from extract_session import extract_tool_failures
    failures = extract_tool_failures(records)
    assert len(failures) == 1
    assert failures[0]["tool_name"] == "Read"
    assert failures[0]["error_content"] == "<tool_use_error>File does not exist.</tool_use_error>"


def test_extract_api_errors():
    records = [
        {
            "type": "system", "subtype": "api_error",
            "uuid": "e1", "sessionId": "s1", "timestamp": "2026-03-04T10:00:00.000Z",
            "cause": {"code": "ECONNRESET"}, "retryAttempt": 1, "maxRetries": 10
        },
    ]
    from extract_session import extract_api_errors
    errors = extract_api_errors(records)
    assert len(errors) == 1
    assert errors[0]["code"] == "ECONNRESET"
    assert errors[0]["retry_attempt"] == 1


def test_extract_compactions():
    records = [
        {
            "type": "system", "subtype": "compact_boundary",
            "uuid": "c1", "sessionId": "s1", "timestamp": "2026-03-04T10:00:00.000Z",
            "compactMetadata": {"trigger": "auto", "preTokens": 168000}
        },
    ]
    from extract_session import extract_compactions
    comps = extract_compactions(records)
    assert len(comps) == 1
    assert comps[0]["trigger"] == "auto"
    assert comps[0]["pre_tokens"] == 168000
```

**Step 2: Run test to verify it fails**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: ImportError — no `extract_skills`, etc.

**Step 3: Write implementation**

Add to `extract_session.py`:

```python
import re


def extract_skills(records):
    """Extract Skill tool invocations and their results."""
    skills = []
    # Map tool_use_id -> skill info
    skill_calls = {}

    for r in records:
        if r.get("type") == "assistant":
            for block in r.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Skill":
                    inp = block.get("input", {})
                    skill_calls[block["id"]] = {
                        "skill_name": inp.get("skill", ""),
                        "args": inp.get("args", ""),
                        "timestamp": r.get("timestamp", ""),
                        "result": None,
                    }

        if r.get("type") == "user":
            msg = r.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_result":
                        tid = item.get("tool_use_id", "")
                        if tid in skill_calls:
                            raw = item.get("content", "")
                            if isinstance(raw, str):
                                skill_calls[tid]["result"] = raw[:500]
                            elif isinstance(raw, list):
                                skill_calls[tid]["result"] = " ".join(
                                    t.get("text", "") for t in raw if isinstance(t, dict)
                                )[:500]

    skills = list(skill_calls.values())
    return skills


def extract_subagents(records):
    """Extract Task (subagent) invocations, linking tool_use to tool_result."""
    subagents = []
    task_calls = {}

    for r in records:
        if r.get("type") == "assistant":
            for block in r.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Task":
                    inp = block.get("input", {})
                    task_calls[block["id"]] = {
                        "tool_use_id": block["id"],
                        "description": inp.get("description", ""),
                        "prompt": inp.get("prompt", "")[:500],
                        "subagent_type": inp.get("subagent_type", ""),
                        "timestamp": r.get("timestamp", ""),
                        "agent_id": None,
                        "status": None,
                        "duration_ms": None,
                        "total_tokens": None,
                        "tool_uses": None,
                        "result_preview": None,
                    }

        if r.get("type") == "user":
            msg = r.get("message", {})
            content = msg.get("content", [])
            tool_use_result = r.get("toolUseResult", {})

            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_result":
                        tid = item.get("tool_use_id", "")
                        if tid in task_calls:
                            tc = task_calls[tid]
                            tc["status"] = tool_use_result.get("status", "unknown")

                            # Parse agentId and usage from result content
                            raw = item.get("content", "")
                            if isinstance(raw, list):
                                for part in raw:
                                    if isinstance(part, dict):
                                        text = part.get("text", "")
                                        # Extract agentId
                                        aid_match = re.search(r"agentId:\s*(\S+)", text)
                                        if aid_match:
                                            tc["agent_id"] = aid_match.group(1)
                                        # Extract usage
                                        tok_match = re.search(r"total_tokens:\s*(\d+)", text)
                                        if tok_match:
                                            tc["total_tokens"] = int(tok_match.group(1))
                                        tu_match = re.search(r"tool_uses:\s*(\d+)", text)
                                        if tu_match:
                                            tc["tool_uses"] = int(tu_match.group(1))
                                        dur_match = re.search(r"duration_ms:\s*(\d+)", text)
                                        if dur_match:
                                            tc["duration_ms"] = int(dur_match.group(1))
                                        # First text block without agentId is the result
                                        if not aid_match and not tc["result_preview"]:
                                            tc["result_preview"] = text[:500]
                            elif isinstance(raw, str):
                                aid_match = re.search(r"agentId:\s*(\S+)", raw)
                                if aid_match:
                                    tc["agent_id"] = aid_match.group(1)
                                tc["result_preview"] = raw[:500]

                            # Also check toolUseResult for async launches
                            if tool_use_result.get("agentId"):
                                tc["agent_id"] = tool_use_result["agentId"]

    subagents = list(task_calls.values())
    return subagents


def extract_tool_failures(records):
    """Extract tool results where is_error is True."""
    failures = []
    # Build tool_use_id -> tool_name map
    tool_name_map = {}
    for r in records:
        if r.get("type") == "assistant":
            for block in r.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_name_map[block["id"]] = block.get("name", "unknown")

    for r in records:
        if r.get("type") == "user":
            msg = r.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("is_error") is True:
                        tid = item.get("tool_use_id", "")
                        failures.append({
                            "tool_use_id": tid,
                            "tool_name": tool_name_map.get(tid, "unknown"),
                            "error_content": item.get("content", "")[:500] if isinstance(item.get("content"), str) else str(item.get("content", ""))[:500],
                            "timestamp": r.get("timestamp", ""),
                        })
    return failures


def extract_api_errors(records):
    """Extract system api_error records."""
    errors = []
    for r in records:
        if r.get("type") == "system" and r.get("subtype") == "api_error":
            cause = r.get("cause", {})
            errors.append({
                "code": cause.get("code", "unknown"),
                "timestamp": r.get("timestamp", ""),
                "retry_attempt": r.get("retryAttempt", 0),
                "max_retries": r.get("maxRetries", 0),
                "retry_in_ms": r.get("retryInMs", 0),
            })
    return errors


def extract_compactions(records):
    """Extract compact_boundary system records."""
    compactions = []
    for r in records:
        if r.get("type") == "system" and r.get("subtype") == "compact_boundary":
            cm = r.get("compactMetadata", {})
            compactions.append({
                "timestamp": r.get("timestamp", ""),
                "trigger": cm.get("trigger", "unknown"),
                "pre_tokens": cm.get("preTokens", 0),
            })
    return compactions
```

**Step 4: Run test to verify it passes**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: `All tests passed.`

**Step 5: Commit**

```bash
git add skills/session-analyst/extract_session.py skills/session-analyst/test_extract.py
git commit -m "feat(session-analyst): add extraction for skills, subagents, failures, errors, compactions"
```

---

### Task 6: Python Preprocessor — Main Entry Point and CLI

**Files:**
- Modify: `skills/session-analyst/extract_session.py`
- Modify: `skills/session-analyst/test_extract.py`

Wire everything together: CLI argument parsing, session resolution, subagent file discovery, and JSON output.

**Step 1: Write the failing test**

Append to `test_extract.py`:

```python
def test_full_extraction_to_json():
    """Integration test: full extraction produces valid JSON output."""
    records = [
        {
            "type": "user", "uuid": "u1", "parentUuid": None,
            "sessionId": "sess-001", "timestamp": "2026-03-04T10:00:00.000Z",
            "isSidechain": False, "cwd": "/Users/me/project",
            "gitBranch": "main", "version": "2.1.37",
            "message": {"role": "user", "content": "Fix the bug"}
        },
        {
            "type": "assistant", "uuid": "a1", "parentUuid": "u1",
            "sessionId": "sess-001", "timestamp": "2026-03-04T10:00:01.000Z",
            "slug": "bugfix-session",
            "message": {
                "model": "claude-opus-4-6", "id": "msg_001", "role": "assistant",
                "content": [{"type": "text", "text": "I'll look into it."}],
                "usage": {"input_tokens": 100, "output_tokens": 20}
            }
        },
        {
            "type": "system", "subtype": "turn_duration",
            "uuid": "s1", "sessionId": "sess-001", "timestamp": "2026-03-04T10:00:30.000Z",
            "durationMs": 30000
        },
    ]
    path = _write_jsonl(records)
    try:
        from extract_session import extract_session
        result = extract_session(path)
        assert result["metadata"]["session_id"] == "sess-001"
        assert result["metadata"]["slug"] == "bugfix-session"
        assert len(result["conversation"]) >= 2
        assert result["skills"] == []
        assert result["subagents"] == []
        assert result["tool_failures"] == []
        assert result["api_errors"] == []
        assert result["compactions"] == []
        assert result["is_main_session"] is True
    finally:
        os.unlink(path)


def test_extract_session_rejects_subagent():
    records = [
        {
            "type": "user", "uuid": "u1", "isSidechain": True, "agentId": "abc123",
            "sessionId": "parent-sess", "timestamp": "2026-03-04T10:00:00.000Z",
            "message": {"role": "user", "content": "task prompt"}
        },
    ]
    path = _write_jsonl(records)
    try:
        from extract_session import extract_session
        result = extract_session(path)
        assert result["is_main_session"] is False
        assert "error" in result
    finally:
        os.unlink(path)
```

**Step 2: Run test to verify it fails**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: ImportError — no `extract_session`.

**Step 3: Write implementation**

Add to `extract_session.py`:

```python
from pathlib import Path


def find_subagent_files(session_jsonl_path):
    """Find all subagent JSONL files for a given parent session.

    Looks in <session-uuid>/subagents/agent-*.jsonl relative to the session file.
    """
    p = Path(session_jsonl_path)
    session_id = p.stem  # UUID without .jsonl
    subagent_dir = p.parent / session_id / "subagents"
    if not subagent_dir.is_dir():
        return []
    return sorted(subagent_dir.glob("agent-*.jsonl"))


def extract_session(session_jsonl_path):
    """Full extraction pipeline for one session.

    Returns a dict ready to be serialized as JSON.
    If the file is a subagent session, returns {"is_main_session": False, "error": "..."}.
    """
    if not is_main_session(session_jsonl_path):
        return {
            "is_main_session": False,
            "error": f"Target file is a subagent session, not a main session. Path: {session_jsonl_path}",
        }

    records = parse_jsonl(session_jsonl_path)

    result = {
        "is_main_session": True,
        "source_file": str(session_jsonl_path),
        "metadata": extract_metadata(records),
        "conversation": extract_conversation(records),
        "skills": extract_skills(records),
        "subagents": extract_subagents(records),
        "tool_failures": extract_tool_failures(records),
        "api_errors": extract_api_errors(records),
        "compactions": extract_compactions(records),
    }

    # Discover and note subagent files (don't extract them here — the skill does that)
    subagent_files = find_subagent_files(session_jsonl_path)
    result["subagent_files"] = [str(f) for f in subagent_files]

    return result


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract signals from Claude Code session JSONL files."
    )
    parser.add_argument("session_file", help="Path to the session .jsonl file")
    parser.add_argument(
        "--output", "-o",
        help="Output JSON file path. Defaults to /tmp/session-analyst/<session-id>.json"
    )
    parser.add_argument(
        "--subagent", "-s",
        help="Also extract a specific subagent file and include in output",
    )
    args = parser.parse_args()

    session_path = args.session_file
    if not os.path.isfile(session_path):
        print(f"Error: File not found: {session_path}", file=sys.stderr)
        sys.exit(1)

    result = extract_session(session_path)

    if not result.get("is_main_session"):
        print(result["error"], file=sys.stderr)
        sys.exit(1)

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        session_id = Path(session_path).stem
        output_dir = Path("/tmp/session-analyst")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(output_dir / f"{session_id}.json")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Extracted to: {output_path}")
    print(f"Session: {result['metadata'].get('slug', result['metadata'].get('session_id', 'unknown'))}")
    print(f"Turns: {result['metadata']['turn_count']}")
    print(f"Skills: {len(result['skills'])}")
    print(f"Subagents: {len(result['subagents'])}")
    print(f"Subagent files: {len(result['subagent_files'])}")
    print(f"Tool failures: {len(result['tool_failures'])}")
    print(f"API errors: {len(result['api_errors'])}")
    print(f"Compactions: {len(result['compactions'])}")


if __name__ == "__main__":
    main()
```

**Step 4: Run test to verify it passes**

Run: `python3 skills/session-analyst/test_extract.py`
Expected: `All tests passed.`

**Step 5: Smoke test against a real session file**

Run: `python3 skills/session-analyst/extract_session.py ~/.claude/projects/-Users-meixueting-work-wolfhead-skills/4c2bbfc8-3888-4258-8ae1-32c9b5fdea76.jsonl`

Expected: Summary output with session stats, JSON written to `/tmp/session-analyst/`.

**Step 6: Commit**

```bash
git add skills/session-analyst/extract_session.py skills/session-analyst/test_extract.py
git commit -m "feat(session-analyst): add full extraction pipeline with CLI and subagent discovery"
```

---

### Task 7: Write SKILL.md — Session Analyst Skill Instructions

**Files:**
- Create: `skills/session-analyst/SKILL.md`

This is the skill file that instructs the agent on how to perform the analysis. No tests — it's markdown instructions.

**Step 1: Write the SKILL.md**

Create `skills/session-analyst/SKILL.md`:

```markdown
---
name: session-analyst
description: "Use when the user wants to review a past session's performance. Analyzes session transcripts to evaluate skill effectiveness, agent behavior, usage patterns, and user interaction quality. Produces a structured review report with findings, suggestions, and gap analysis. Does NOT modify any skill files — observe and report only."
---

# Session Analyst

## Overview

You are a performance analyst — a manager reviewing how the team (skills, agents, user) performed in a session. Read session transcripts, analyze execution patterns, and produce a structured review report.

<HARD-RULE>
This skill is ANALYSIS ONLY. Do NOT modify any skill files, CLAUDE.md, or configuration. Produce a report with findings and suggestions. The user decides what to act on.
</HARD-RULE>

## Invocation

The user provides a session reference:
- No argument → analyze the most recent session for the current project
- Session ID (UUID or partial) → analyze that specific session
- `latest N` → analyze the N most recent sessions (separate reports)

## Process

### 1. Resolve Session

Find the session JSONL file(s):

```bash
# Current project's session directory
PROJECT_DIR=$(echo "$PWD" | sed 's|/|-|g')
SESSION_DIR="$HOME/.claude/projects/$PROJECT_DIR"

# List sessions by modification time (most recent first)
ls -lt "$SESSION_DIR"/*.jsonl
```

If the user provided a session ID, match it against filenames. If "latest N", take the N most recent.

### 2. Run Preprocessor

For each session, run the Python preprocessor to extract signals:

```bash
python3 <skill-dir>/extract_session.py <session.jsonl> --output /tmp/session-analyst/<session-id>.json
```

The preprocessor:
- Validates this is a main session (not a subagent file)
- Extracts: metadata, conversation flow, skills, subagents, failures, errors, compactions
- Discovers subagent JSONL files
- Outputs condensed JSON

Read the output JSON to understand the session overview.

### 3. Extract Subagent Transcripts

For each subagent file listed in the output's `subagent_files` array, run the preprocessor in subagent mode:

```bash
python3 <skill-dir>/extract_session.py <subagent.jsonl> --output /tmp/session-analyst/subagent-<agent-id>.json
```

Note: subagent files will fail the main-session check. For subagent extraction, the preprocessor detects this and still extracts the data (returning `is_main_session: false` with full extraction).

### 4. Fan-Out Analysis

Dispatch one subagent per subagent transcript for parallel analysis. Each subagent receives:

**Subagent analysis prompt:**
```
You are analyzing a subagent's execution transcript for a session performance review.

## Context
- Parent session: <session slug/id>
- This subagent was dispatched with task: "<description>"
- Subagent type: <subagent_type>
- Original prompt (first 500 chars): "<prompt preview>"

## Condensed Transcript
<paste the condensed JSON for this subagent>

## Analyze For

1. **Failures & Retries**: Did the subagent encounter tool errors? How many? Did it recover or loop?
2. **Strategy**: Did it follow an efficient approach or wander? Any doom loops (repeated edits to same file)?
3. **Skill Compliance**: If a skill was active, did the subagent follow the skill's instructions?
4. **Tool Usage**: Were the right tools used? Any unnecessary tool calls? Could fewer calls have achieved the same result?
5. **Result Quality**: Did it successfully complete its task? Was the output useful to the parent?

## Output Format
Return a JSON object:
{
  "agent_id": "<id>",
  "task_description": "<what it was asked to do>",
  "outcome": "success|partial|failure",
  "findings": ["<finding 1>", "<finding 2>"],
  "inefficiencies": ["<issue 1>"],
  "skill_compliance": "<compliant|deviated|no-skill-active>",
  "tool_failure_count": <N>,
  "doom_loop_detected": true|false,
  "suggestions": ["<suggestion 1>"]
}
```

Use cheap/fast subagent model (haiku) for these analyses.

### 5. Analyze Parent Session

While subagents run, the main agent analyzes the parent session condensed JSON for:

- **User interaction patterns**: How clear were instructions? Any corrections or clarifications?
- **Skill invocation patterns**: Were skills invoked at the right time? Missing skill invocations?
- **Overall flow**: Was the session efficient? How many turns? Token usage?
- **Gaps**: Situations where no skill applied but one should have

### 6. Synthesize Report

Combine parent analysis + all subagent analysis reports into the 4-section review.

**Report structure:**

```markdown
# Session Review: <slug>
**Date**: <date>
**Session ID**: <uuid>
**Duration**: <sum of turn_durations, formatted as Xm Ys>
**Model**: <model>
**Tokens**: <total_input + total_output> (input: <N>, output: <N>, cached: <N>)
**Turns**: <turn_count>
**Subagents**: <count>
**Tool Failures**: <count>

---

## 1. Per-Skill Performance

(For each skill invoked in the session)

### Skill: <name>
**Invoked by**: <context — what the user/agent was doing when this skill was called>
**Times used**: <N>

#### Findings
- <What happened during execution>

#### Caller Suggestions
- <How the caller could use this skill better>

#### Skill Suggestions
- <Non-trivial improvements to the skill itself>

#### Conclusion
<effective / partially effective / ineffective>

---

## 2. Usage Patterns

### Recurring Patterns
- <Patterns across tool usage and agent behavior>

### Anti-Patterns
- <Doom loops, premature completion, unnecessary subagent spawning, etc.>

### Efficiency Observations
- <Token waste, redundant tool calls, etc.>

---

## 3. Gap Analysis

### Missing Skills
- <Situations where a skill would have helped>

### Missing Agent Specializations
- <Subagent types that would have been useful>

---

## 4. User Interaction Analysis

### Communication Patterns
- <Instruction clarity, context provided, feedback style>

### Detected Preferences
- <Recurring choices or corrections suggesting a preference>

### Memory Suggestions
| Preference | Scope | Suggested Entry |
|-----------|-------|----------------|
| <preference> | Global/Project | <what to add to CLAUDE.md> |
```

### 7. Save Report

Write the report to:
```
docs/reviews/YYYY-MM-DD-session-<slug>-review.md
```

Create the `docs/reviews/` directory if it doesn't exist.

Display a brief summary to the user:
- Session slug and date
- Number of skills analyzed
- Number of subagents analyzed
- Top 2-3 most important findings
- Path to full report

## Important Notes

- **Non-trivial suggestions only.** Don't report obvious things like "the agent used Read to read a file." Focus on actionable improvements.
- **Caller suggestions matter.** Often the issue isn't the skill itself but how it was invoked — wrong timing, missing context, bad arguments.
- **Be specific.** "The brainstorming skill was invoked but the user had already decided on an approach" is useful. "The skill could be improved" is not.
- **Detect preferences, don't assume.** A user correcting something once is an observation. Correcting the same way 3 times is a preference.
- **Token efficiency.** Note when subagents used significantly more tokens than expected for their task.
```

**Step 2: Commit**

```bash
git add skills/session-analyst/SKILL.md
git commit -m "feat(session-analyst): add SKILL.md with full analyst workflow instructions"
```

---

### Task 8: Update README with New Skill

**Files:**
- Modify: `README.md`

**Step 1: Update the skills table**

In `README.md`, add the session-analyst row to the Available Skills table:

```markdown
| [session-analyst](skills/session-analyst/) | Analyzes session transcripts to review skill, agent, and user performance. Produces structured reports with findings, suggestions, and gap analysis. |
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add session-analyst to README skills table"
```

---

### Task 9: Integration Test Against Real Session

**Files:**
- No new files — this is a validation task

**Step 1: Run preprocessor against the current session**

```bash
python3 skills/session-analyst/extract_session.py \
  ~/.claude/projects/-Users-meixueting-work-wolfhead-skills/4c2bbfc8-3888-4258-8ae1-32c9b5fdea76.jsonl
```

Expected: Successful extraction with stats printed. Check the output JSON is well-formed.

**Step 2: Verify subagent files are discovered**

```bash
cat /tmp/session-analyst/4c2bbfc8-3888-4258-8ae1-32c9b5fdea76.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Subagent files: {len(d[\"subagent_files\"])}')"
```

Expected: `Subagent files: 5` (matching the 5 files we saw earlier in the subagents dir).

**Step 3: Run preprocessor against a subagent file (expect rejection)**

```bash
python3 skills/session-analyst/extract_session.py \
  ~/.claude/projects/-Users-meixueting-work-wolfhead-skills/4c2bbfc8-3888-4258-8ae1-32c9b5fdea76/subagents/agent-af54a0eeda4518ec6.jsonl
```

Expected: Error message about subagent session, exit code 1.

**Step 4: Verify output JSON structure**

```bash
python3 -c "
import json
with open('/tmp/session-analyst/4c2bbfc8-3888-4258-8ae1-32c9b5fdea76.json') as f:
    d = json.load(f)
    required = ['metadata', 'conversation', 'skills', 'subagents', 'tool_failures', 'api_errors', 'compactions', 'subagent_files']
    for key in required:
        assert key in d, f'Missing key: {key}'
    print('All required keys present.')
    print(f'Metadata keys: {list(d[\"metadata\"].keys())}')
    print(f'Conversation entries: {len(d[\"conversation\"])}')
    print(f'Skills: {len(d[\"skills\"])}')
    print(f'Subagents: {len(d[\"subagents\"])}')
"
```

Expected: All keys present, reasonable counts.

---

### Task 10: End-to-End Test — Invoke the Skill

**Files:**
- No new files — manual validation

**Step 1: Install the skill for Claude Code**

Copy or symlink the skill directory into Claude Code's skill path:

```bash
mkdir -p ~/.claude/skills
ln -sf /Users/meixueting/work/wolfhead_skills/skills/session-analyst ~/.claude/skills/session-analyst
```

**Step 2: In a new Claude Code session, invoke the skill**

Start a new Claude Code session and run:
```
/session-analyst
```

Expected: The skill loads, runs the preprocessor, analyzes the most recent session, produces a report.

**Step 3: Review the generated report**

Check `docs/reviews/` for the generated markdown file. Verify it has all 4 sections with substantive content.

**Step 4: Fix any issues found during manual testing, commit fixes**

```bash
git add -A
git commit -m "fix(session-analyst): address issues found in end-to-end testing"
```

---

Plan complete and saved to `docs/plans/2026-03-04-session-analyst-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?

<function_calls>
<invoke name="AskUserQuestion">
<parameter name="questions">[{"question": "How would you like to execute this plan?", "header": "Execution", "options": [{"label": "Subagent-Driven (this session)", "description": "I dispatch a fresh subagent per task, review between tasks. Fast iteration within this conversation."}, {"label": "Parallel Session (separate)", "description": "Open a new Claude Code session in the same directory, use executing-plans skill there. Keeps this session clean for review."}], "multiSelect": false}]