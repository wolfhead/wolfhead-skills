# OpenClaw Session Analyst Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a new `openclaw-session-analyst` skill with search, extract, and analysis pipeline for OpenClaw session transcripts.

**Architecture:** Separate skill from `session-analyst` (Claude Code). Two Python scripts (`search_sessions.py`, `extract_session.py`) parse OpenClaw's JSONL format and produce condensed JSON. SKILL.md orchestrates the 4-step pipeline: search → extract → dispatch subagent analysts → synthesize report. The subagent-analyst skill is reused as-is.

**Tech Stack:** Python 3 (stdlib only), JSONL parsing, unittest

**Reference docs:**
- Format spec: `docs/openclaw-session-format.md`
- Design: `docs/plans/2026-03-04-openclaw-session-analyst-design.md`
- Claude Code equivalent: `skills/session-analyst/`

---

### Task 1: Create directory structure and scaffold extract_session.py

**Files:**
- Create: `skills/openclaw-session-analyst/scripts/extract_session.py`
- Create: `skills/openclaw-session-analyst/scripts/test_extract.py`

**Step 1: Create directories**

```bash
mkdir -p skills/openclaw-session-analyst/scripts
```

**Step 2: Write the first failing test — parse_jsonl and classify_entry**

Write `skills/openclaw-session-analyst/scripts/test_extract.py`:

```python
#!/usr/bin/env python3
"""Tests for OpenClaw extract_session.py."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_session import parse_jsonl, classify_entry

# Helper: write JSONL records to a temp file
def _write_jsonl(tmpdir, filename, records):
    path = os.path.join(tmpdir, filename)
    with open(path, "w") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    return path


class TestParseJsonl(unittest.TestCase):
    def test_basic(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "test.jsonl", [
                {"type": "session", "version": 3, "id": "abc"},
                {"type": "message", "id": "aaa", "message": {"role": "user"}},
            ])
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)

    def test_skip_malformed(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "bad.jsonl")
            with open(path, "w") as f:
                f.write('{"type": "session"}\n')
                f.write('not valid json\n')
                f.write('{"type": "message"}\n')
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "empty.jsonl")
            open(path, "w").close()
            self.assertEqual(parse_jsonl(path), [])


class TestClassifyEntry(unittest.TestCase):
    def test_session_header(self):
        self.assertEqual(classify_entry({"type": "session", "version": 3}), "session_header")

    def test_user_message(self):
        self.assertEqual(classify_entry({
            "type": "message", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}
        }), "human_message")

    def test_assistant_message(self):
        self.assertEqual(classify_entry({
            "type": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": "hello"}]}
        }), "assistant")

    def test_tool_result(self):
        self.assertEqual(classify_entry({
            "type": "message", "message": {"role": "toolResult", "toolName": "read"}
        }), "tool_result")

    def test_model_change(self):
        self.assertEqual(classify_entry({"type": "model_change", "modelId": "x"}), "model_change")

    def test_thinking_level_change(self):
        self.assertEqual(classify_entry({"type": "thinking_level_change", "thinkingLevel": "off"}), "thinking_level_change")

    def test_custom(self):
        self.assertEqual(classify_entry({"type": "custom", "customType": "model-snapshot"}), "custom")

    def test_compaction(self):
        self.assertEqual(classify_entry({"type": "compaction", "summary": "..."}), "compaction")

    def test_unknown(self):
        self.assertEqual(classify_entry({"type": "something_else"}), "skip")


if __name__ == "__main__":
    unittest.main()
```

**Step 3: Run test to verify it fails**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py -v
```

Expected: `ModuleNotFoundError: No module named 'extract_session'`

**Step 4: Write minimal implementation for parse_jsonl and classify_entry**

Write `skills/openclaw-session-analyst/scripts/extract_session.py`:

```python
#!/usr/bin/env python3
"""
Extract structured signals from OpenClaw JSONL session files.

Parses OpenClaw session JSONL and produces condensed JSON with metadata,
conversation flow, tool usage, cost tracking, and model switching data.

Reference: docs/openclaw-session-format.md
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path

CONTENT_PREVIEW_MAX_CHARS = 500


def parse_jsonl(path):
    """Read a JSONL file and return a list of dicts, skipping malformed lines."""
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def classify_entry(entry):
    """Classify an OpenClaw JSONL entry into a semantic category.

    Returns one of:
        session_header, human_message, assistant, tool_result,
        model_change, thinking_level_change, custom, compaction, skip
    """
    etype = entry.get("type")

    if etype == "session":
        return "session_header"

    if etype == "message":
        role = entry.get("message", {}).get("role")
        if role == "user":
            return "human_message"
        if role == "assistant":
            return "assistant"
        if role == "toolResult":
            return "tool_result"
        return "skip"

    if etype == "model_change":
        return "model_change"

    if etype == "thinking_level_change":
        return "thinking_level_change"

    if etype == "custom":
        return "custom"

    if etype == "compaction":
        return "compaction"

    return "skip"
```

**Step 5: Run test to verify it passes**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py -v
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/extract_session.py skills/openclaw-session-analyst/scripts/test_extract.py
git commit -m "feat(openclaw-session-analyst): scaffold extract with parse_jsonl and classify_entry"
```

---

### Task 2: Implement extract_metadata

**Files:**
- Modify: `skills/openclaw-session-analyst/scripts/extract_session.py`
- Modify: `skills/openclaw-session-analyst/scripts/test_extract.py`

**Step 1: Write the failing test**

Append to `test_extract.py`:

```python
from extract_session import extract_metadata


def _make_session_records():
    """Build a minimal realistic OpenClaw session for testing."""
    return [
        {"type": "session", "version": 3, "id": "sess-001", "timestamp": "2026-03-02T00:00:00.000Z", "cwd": "/workspace"},
        {"type": "model_change", "id": "mc1", "parentId": None, "timestamp": "2026-03-02T00:00:00.000Z", "provider": "prov-a", "modelId": "model-a"},
        {"type": "custom", "customType": "model-snapshot", "data": {"provider": "prov-a", "modelId": "model-a", "modelApi": "anthropic-messages", "timestamp": 1000}, "id": "cs1", "parentId": "mc1", "timestamp": "2026-03-02T00:00:00.100Z"},
        {"type": "message", "id": "u1", "parentId": "cs1", "timestamp": "2026-03-02T00:00:01.000Z", "message": {"role": "user", "content": [{"type": "text", "text": "hello"}], "timestamp": 1000}},
        {"type": "message", "id": "a1", "parentId": "u1", "timestamp": "2026-03-02T00:00:02.000Z", "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": "hi there"}],
            "provider": "prov-a", "model": "model-a", "api": "anthropic-messages",
            "usage": {"input": 100, "output": 50, "cacheRead": 10, "cacheWrite": 200, "totalTokens": 360, "cost": {"input": 0.01, "output": 0.05, "cacheRead": 0.001, "cacheWrite": 0.02, "total": 0.081}},
            "stopReason": "stop", "timestamp": 2000
        }},
        {"type": "message", "id": "u2", "parentId": "a1", "timestamp": "2026-03-02T00:00:05.000Z", "message": {"role": "user", "content": [{"type": "text", "text": "thanks"}], "timestamp": 5000}},
        {"type": "message", "id": "a2", "parentId": "u2", "timestamp": "2026-03-02T00:00:06.000Z", "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": "bye"}],
            "provider": "prov-b", "model": "model-b", "api": "openai-completions",
            "usage": {"input": 50, "output": 20, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 70, "cost": {"input": 0.001, "output": 0.002, "cacheRead": 0, "cacheWrite": 0, "total": 0.003}},
            "stopReason": "stop", "timestamp": 6000
        }},
    ]


class TestExtractMetadata(unittest.TestCase):
    def test_basic_metadata(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["session_id"], "sess-001")
        self.assertEqual(meta["cwd"], "/workspace")
        self.assertEqual(meta["first_timestamp"], "2026-03-02T00:00:00.000Z")
        self.assertEqual(meta["last_timestamp"], "2026-03-02T00:00:06.000Z")
        self.assertEqual(meta["turn_count"], 2)  # 2 user messages

    def test_token_totals(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["input_tokens"], 150)   # 100 + 50
        self.assertEqual(meta["output_tokens"], 70)    # 50 + 20
        self.assertEqual(meta["cache_read_tokens"], 10)
        self.assertEqual(meta["cache_write_tokens"], 200)

    def test_cost_total(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        self.assertAlmostEqual(meta["total_cost"], 0.084, places=3)  # 0.081 + 0.003

    def test_models_and_providers(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        self.assertEqual(sorted(meta["models_used"]), ["model-a", "model-b"])
        self.assertEqual(sorted(meta["providers_used"]), ["prov-a", "prov-b"])

    def test_empty_records(self):
        meta = extract_metadata([])
        self.assertEqual(meta["turn_count"], 0)
        self.assertEqual(meta["total_cost"], 0)
```

**Step 2: Run test to verify it fails**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractMetadata -v
```

Expected: `ImportError` for `extract_metadata`

**Step 3: Write implementation**

Add to `extract_session.py`:

```python
def extract_metadata(records):
    """Extract session metadata from parsed OpenClaw records.

    Returns dict with: session_id, cwd, first_timestamp, last_timestamp,
    models_used, providers_used, total_cost, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, turn_count, channel, chat_type.
    """
    meta = {
        "session_id": None,
        "cwd": None,
        "first_timestamp": None,
        "last_timestamp": None,
        "models_used": [],
        "providers_used": [],
        "total_cost": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "turn_count": 0,
        "channel": None,
        "chat_type": None,
    }

    models_seen = set()
    providers_seen = set()

    for rec in records:
        cat = classify_entry(rec)

        # Session header
        if cat == "session_header":
            meta["session_id"] = rec.get("id")
            meta["cwd"] = rec.get("cwd")

        # Timestamps from all entries
        ts = rec.get("timestamp")
        if ts and isinstance(ts, str):
            if meta["first_timestamp"] is None:
                meta["first_timestamp"] = ts
            meta["last_timestamp"] = ts

        # User message = one turn
        if cat == "human_message":
            meta["turn_count"] += 1

        # Assistant messages: tokens, cost, model tracking
        if cat == "assistant":
            msg = rec.get("message", {})
            model = msg.get("model")
            provider = msg.get("provider")
            if model:
                models_seen.add(model)
            if provider:
                providers_seen.add(provider)

            usage = msg.get("usage", {})
            if isinstance(usage, dict):
                meta["input_tokens"] += usage.get("input", 0)
                meta["output_tokens"] += usage.get("output", 0)
                meta["cache_read_tokens"] += usage.get("cacheRead", 0)
                meta["cache_write_tokens"] += usage.get("cacheWrite", 0)
                cost = usage.get("cost", {})
                if isinstance(cost, dict):
                    meta["total_cost"] += cost.get("total", 0)

    meta["models_used"] = sorted(models_seen)
    meta["providers_used"] = sorted(providers_seen)
    return meta
```

**Step 4: Run test to verify it passes**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractMetadata -v
```

Expected: All PASS

**Step 5: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/extract_session.py skills/openclaw-session-analyst/scripts/test_extract.py
git commit -m "feat(openclaw-session-analyst): implement extract_metadata with cost and multi-model tracking"
```

---

### Task 3: Implement cost_by_model and model_switches extraction

**Files:**
- Modify: `skills/openclaw-session-analyst/scripts/extract_session.py`
- Modify: `skills/openclaw-session-analyst/scripts/test_extract.py`

**Step 1: Write failing tests**

Append to `test_extract.py`:

```python
from extract_session import extract_cost_by_model, extract_model_switches


class TestExtractCostByModel(unittest.TestCase):
    def test_basic(self):
        records = _make_session_records()
        cost = extract_cost_by_model(records)
        self.assertIn("model-a", cost)
        self.assertIn("model-b", cost)
        self.assertAlmostEqual(cost["model-a"]["total"], 0.081, places=3)
        self.assertAlmostEqual(cost["model-b"]["total"], 0.003, places=3)
        self.assertEqual(cost["model-a"]["turn_count"], 1)
        self.assertEqual(cost["model-b"]["turn_count"], 1)

    def test_empty(self):
        self.assertEqual(extract_cost_by_model([]), {})


class TestExtractModelSwitches(unittest.TestCase):
    def test_detects_switch(self):
        records = _make_session_records()
        switches = extract_model_switches(records)
        self.assertEqual(len(switches), 1)
        self.assertEqual(switches[0]["from_model"], "model-a")
        self.assertEqual(switches[0]["to_model"], "model-b")

    def test_no_switch_single_model(self):
        records = [
            {"type": "message", "id": "a1", "timestamp": "T1", "message": {"role": "assistant", "model": "m1", "provider": "p1", "content": [], "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"total": 0}}, "stopReason": "stop", "timestamp": 1}},
            {"type": "message", "id": "a2", "timestamp": "T2", "message": {"role": "assistant", "model": "m1", "provider": "p1", "content": [], "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"total": 0}}, "stopReason": "stop", "timestamp": 2}},
        ]
        self.assertEqual(extract_model_switches(records), [])

    def test_empty(self):
        self.assertEqual(extract_model_switches([]), [])
```

**Step 2: Run tests to verify they fail**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractCostByModel test_extract.py::TestExtractModelSwitches -v
```

Expected: `ImportError`

**Step 3: Implement**

Add to `extract_session.py`:

```python
def extract_cost_by_model(records):
    """Aggregate cost and token usage per model.

    Returns dict: model_id -> {input, output, cache_read, cache_write, total, turn_count}
    """
    models = {}
    for rec in records:
        if classify_entry(rec) != "assistant":
            continue
        msg = rec.get("message", {})
        model = msg.get("model")
        if not model:
            continue
        if model not in models:
            models[model] = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "total": 0, "turn_count": 0}
        models[model]["turn_count"] += 1
        cost = msg.get("usage", {}).get("cost", {})
        if isinstance(cost, dict):
            models[model]["input"] += cost.get("input", 0)
            models[model]["output"] += cost.get("output", 0)
            models[model]["cache_read"] += cost.get("cacheRead", 0)
            models[model]["cache_write"] += cost.get("cacheWrite", 0)
            models[model]["total"] += cost.get("total", 0)
    return models


def extract_model_switches(records):
    """Detect model switches across assistant messages.

    Returns list of dicts: {timestamp, from_model, from_provider, to_model, to_provider}
    """
    switches = []
    last_model = None
    last_provider = None
    for rec in records:
        if classify_entry(rec) != "assistant":
            continue
        msg = rec.get("message", {})
        model = msg.get("model")
        provider = msg.get("provider")
        if model and last_model and model != last_model:
            switches.append({
                "timestamp": rec.get("timestamp"),
                "from_model": last_model,
                "from_provider": last_provider,
                "to_model": model,
                "to_provider": provider,
            })
        if model:
            last_model = model
            last_provider = provider
    return switches
```

**Step 4: Run tests**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractCostByModel test_extract.py::TestExtractModelSwitches -v
```

Expected: All PASS

**Step 5: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/extract_session.py skills/openclaw-session-analyst/scripts/test_extract.py
git commit -m "feat(openclaw-session-analyst): add cost_by_model and model_switches extraction"
```

---

### Task 4: Implement extract_conversation

**Files:**
- Modify: `skills/openclaw-session-analyst/scripts/extract_session.py`
- Modify: `skills/openclaw-session-analyst/scripts/test_extract.py`

**Step 1: Write failing tests**

Append to `test_extract.py`:

```python
from extract_session import extract_conversation


class TestExtractConversation(unittest.TestCase):
    def test_basic_flow(self):
        records = _make_session_records()
        conv = extract_conversation(records)
        # Should have: human, assistant, human, assistant
        self.assertEqual(len(conv), 4)
        self.assertEqual(conv[0]["type"], "human_message")
        self.assertEqual(conv[0]["text"], "hello")
        self.assertEqual(conv[1]["type"], "assistant_turn")
        self.assertEqual(conv[1]["text"], "hi there")
        self.assertEqual(conv[1]["model"], "model-a")
        self.assertAlmostEqual(conv[1]["cost"], 0.081, places=3)
        self.assertEqual(conv[1]["tool_calls"], [])

    def test_tool_call_and_result(self):
        records = [
            {"type": "message", "id": "a1", "parentId": "u1", "timestamp": "T1", "message": {
                "role": "assistant",
                "content": [
                    {"type": "toolCall", "id": "tc1", "name": "read", "arguments": {"path": "/foo"}},
                    {"type": "toolCall", "id": "tc2", "name": "exec", "arguments": {"command": "ls"}},
                ],
                "provider": "p1", "model": "m1", "api": "anthropic-messages",
                "usage": {"input": 10, "output": 5, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 15, "cost": {"total": 0.01}},
                "stopReason": "toolUse", "timestamp": 1
            }},
            {"type": "message", "id": "tr1", "parentId": "a1", "timestamp": "T2", "message": {
                "role": "toolResult", "toolCallId": "tc1", "toolName": "read",
                "content": [{"type": "text", "text": "file contents here"}],
                "details": {"status": "ok"}, "isError": False, "timestamp": 2
            }},
            {"type": "message", "id": "tr2", "parentId": "tr1", "timestamp": "T3", "message": {
                "role": "toolResult", "toolCallId": "tc2", "toolName": "exec",
                "content": [{"type": "text", "text": "dir1 dir2"}],
                "details": {"status": "ok"}, "isError": False, "timestamp": 3
            }},
        ]
        conv = extract_conversation(records)
        self.assertEqual(len(conv), 3)  # 1 assistant + 2 tool_results
        self.assertEqual(conv[0]["type"], "assistant_turn")
        self.assertEqual(len(conv[0]["tool_calls"]), 2)
        self.assertEqual(conv[0]["tool_calls"][0]["name"], "read")
        self.assertEqual(conv[0]["tool_calls"][0]["tool_call_id"], "tc1")
        self.assertEqual(conv[1]["type"], "tool_result")
        self.assertEqual(conv[1]["tool_name"], "read")
        self.assertFalse(conv[1]["is_error"])

    def test_sender_extraction(self):
        """User messages with sender metadata should extract sender name."""
        records = [
            {"type": "message", "id": "u1", "timestamp": "T1", "message": {
                "role": "user",
                "content": [{"type": "text", "text": 'Sender (untrusted metadata):\n```json\n{"label": "Jojo Wolf"}\n```\n\nhello'}],
                "timestamp": 1
            }},
        ]
        conv = extract_conversation(records)
        self.assertEqual(len(conv), 1)
        self.assertEqual(conv[0]["sender"], "Jojo Wolf")

    def test_truncation(self):
        long_text = "x" * 1000
        records = [
            {"type": "message", "id": "tr1", "timestamp": "T1", "message": {
                "role": "toolResult", "toolCallId": "tc1", "toolName": "read",
                "content": [{"type": "text", "text": long_text}],
                "isError": False, "timestamp": 1
            }},
        ]
        conv = extract_conversation(records)
        self.assertLessEqual(len(conv[0]["content_preview"]), CONTENT_PREVIEW_MAX_CHARS + 10)

    def test_empty(self):
        self.assertEqual(extract_conversation([]), [])
```

**Step 2: Run to verify failure**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractConversation -v
```

**Step 3: Implement**

Add to `extract_session.py`:

```python
def _truncate(text, max_len=CONTENT_PREVIEW_MAX_CHARS):
    """Truncate text, appending '...' if truncated."""
    if not isinstance(text, str):
        text = str(text)
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def _extract_text_content(content):
    """Extract plain text from an OpenClaw content array."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content) if content else ""


def _extract_sender(text):
    """Try to extract sender label from untrusted metadata in user message text.

    OpenClaw wraps sender info like:
    Sender (untrusted metadata):
    ```json
    {"label": "Name", ...}
    ```

    Returns the label string or None.
    """
    m = re.search(r'Sender\s*\(untrusted metadata\):\s*```json\s*(\{[^}]+\})', text, re.DOTALL)
    if m:
        try:
            sender_data = json.loads(m.group(1))
            return sender_data.get("label") or sender_data.get("name")
        except json.JSONDecodeError:
            pass
    return None


def extract_conversation(records):
    """Extract conversation flow as a list of turns.

    Each turn is one of:
    - {"type": "human_message", "text": "...", "sender": "..."|null}
    - {"type": "assistant_turn", "text": "...", "tool_calls": [...], "model": "...", "provider": "...", "cost": float}
    - {"type": "tool_result", "tool_call_id": "...", "tool_name": "...", "is_error": bool, "content_preview": "..."}
    """
    turns = []

    for rec in records:
        cat = classify_entry(rec)
        msg = rec.get("message", {})

        if cat == "human_message":
            text = _extract_text_content(msg.get("content", ""))
            sender = _extract_sender(text)
            turns.append({
                "type": "human_message",
                "text": text,
                "sender": sender,
            })

        elif cat == "assistant":
            content_blocks = msg.get("content", [])
            texts = []
            tool_calls = []
            if isinstance(content_blocks, list):
                for block in content_blocks:
                    btype = block.get("type")
                    if btype == "text":
                        t = block.get("text", "").strip()
                        if t:
                            texts.append(t)
                    elif btype == "toolCall":
                        tool_calls.append({
                            "tool_call_id": block.get("id", ""),
                            "name": block.get("name", ""),
                            "arguments": block.get("arguments", {}),
                        })

            cost_data = msg.get("usage", {}).get("cost", {})
            cost = cost_data.get("total", 0) if isinstance(cost_data, dict) else 0

            turns.append({
                "type": "assistant_turn",
                "text": "\n".join(texts),
                "tool_calls": tool_calls,
                "model": msg.get("model"),
                "provider": msg.get("provider"),
                "cost": cost,
            })

        elif cat == "tool_result":
            raw = _extract_text_content(msg.get("content", ""))
            turns.append({
                "type": "tool_result",
                "tool_call_id": msg.get("toolCallId", ""),
                "tool_name": msg.get("toolName", ""),
                "is_error": bool(msg.get("isError", False)),
                "content_preview": _truncate(raw),
            })

    return turns
```

**Step 4: Run tests**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractConversation -v
```

Expected: All PASS

**Step 5: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/extract_session.py skills/openclaw-session-analyst/scripts/test_extract.py
git commit -m "feat(openclaw-session-analyst): implement extract_conversation with sender and cost per turn"
```

---

### Task 5: Implement extract_tool_failures and extract_compactions

**Files:**
- Modify: `skills/openclaw-session-analyst/scripts/extract_session.py`
- Modify: `skills/openclaw-session-analyst/scripts/test_extract.py`

**Step 1: Write failing tests**

Append to `test_extract.py`:

```python
from extract_session import extract_tool_failures, extract_compactions


class TestExtractToolFailures(unittest.TestCase):
    def test_detects_error(self):
        records = [
            {"type": "message", "id": "tr1", "timestamp": "T1", "message": {
                "role": "toolResult", "toolCallId": "tc1", "toolName": "read",
                "content": [{"type": "text", "text": "ENOENT: file not found"}],
                "details": {"status": "error", "error": "ENOENT"}, "isError": True, "timestamp": 1
            }},
            {"type": "message", "id": "tr2", "timestamp": "T2", "message": {
                "role": "toolResult", "toolCallId": "tc2", "toolName": "exec",
                "content": [{"type": "text", "text": "ok"}],
                "details": {"status": "ok"}, "isError": False, "timestamp": 2
            }},
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["tool_name"], "read")
        self.assertIn("ENOENT", failures[0]["content_preview"])

    def test_details_error_status(self):
        """Also catch details.status == 'error' even if isError is false."""
        records = [
            {"type": "message", "id": "tr1", "timestamp": "T1", "message": {
                "role": "toolResult", "toolCallId": "tc1", "toolName": "read",
                "content": [{"type": "text", "text": '{"status": "error", "error": "ENOENT"}'}],
                "details": {"status": "error", "error": "ENOENT"}, "isError": False, "timestamp": 1
            }},
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(len(failures), 1)

    def test_empty(self):
        self.assertEqual(extract_tool_failures([]), [])


class TestExtractCompactions(unittest.TestCase):
    def test_basic(self):
        records = [
            {"type": "compaction", "id": "c1", "parentId": "x", "timestamp": "2026-03-02T07:00:00Z",
             "summary": "## Goal\nDo something important with lots of detail...",
             "firstKeptEntryId": "k1", "tokensBefore": 50000,
             "details": {"readFiles": ["/a.md", "/b.md"], "modifiedFiles": ["/c.md"]},
             "fromHook": True},
        ]
        comps = extract_compactions(records)
        self.assertEqual(len(comps), 1)
        self.assertEqual(comps[0]["tokens_before"], 50000)
        self.assertEqual(comps[0]["read_files"], ["/a.md", "/b.md"])
        self.assertEqual(comps[0]["modified_files"], ["/c.md"])
        self.assertTrue(comps[0]["from_hook"])
        self.assertLessEqual(len(comps[0]["summary_preview"]), CONTENT_PREVIEW_MAX_CHARS + 10)

    def test_empty(self):
        self.assertEqual(extract_compactions([]), [])
```

**Step 2: Run to verify failure**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractToolFailures test_extract.py::TestExtractCompactions -v
```

**Step 3: Implement**

Add to `extract_session.py`:

```python
def extract_tool_failures(records):
    """Extract tool results that indicate errors.

    Detects errors via isError=True OR details.status=="error".

    Returns list of dicts: {tool_call_id, tool_name, content_preview}
    """
    failures = []
    for rec in records:
        if classify_entry(rec) != "tool_result":
            continue
        msg = rec.get("message", {})
        is_error = msg.get("isError", False)
        details = msg.get("details", {})
        details_error = isinstance(details, dict) and details.get("status") == "error"

        if is_error or details_error:
            raw = _extract_text_content(msg.get("content", ""))
            failures.append({
                "tool_call_id": msg.get("toolCallId", ""),
                "tool_name": msg.get("toolName", ""),
                "content_preview": _truncate(raw),
            })
    return failures


def extract_compactions(records):
    """Extract compaction entries.

    Returns list of dicts: {timestamp, tokens_before, summary_preview, read_files, modified_files, from_hook}
    """
    compactions = []
    for rec in records:
        if classify_entry(rec) != "compaction":
            continue
        details = rec.get("details", {})
        compactions.append({
            "timestamp": rec.get("timestamp"),
            "tokens_before": rec.get("tokensBefore"),
            "summary_preview": _truncate(rec.get("summary", ""), CONTENT_PREVIEW_MAX_CHARS),
            "read_files": details.get("readFiles", []) if isinstance(details, dict) else [],
            "modified_files": details.get("modifiedFiles", []) if isinstance(details, dict) else [],
            "from_hook": rec.get("fromHook", False),
        })
    return compactions
```

**Step 4: Run tests**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractToolFailures test_extract.py::TestExtractCompactions -v
```

Expected: All PASS

**Step 5: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/extract_session.py skills/openclaw-session-analyst/scripts/test_extract.py
git commit -m "feat(openclaw-session-analyst): add tool_failures and compactions extraction"
```

---

### Task 6: Implement extract_session pipeline and CLI

**Files:**
- Modify: `skills/openclaw-session-analyst/scripts/extract_session.py`
- Modify: `skills/openclaw-session-analyst/scripts/test_extract.py`

**Step 1: Write failing tests**

Append to `test_extract.py`:

```python
from extract_session import extract_session


class TestExtractSession(unittest.TestCase):
    def test_full_pipeline(self):
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "sess-001.jsonl", records)
            result = extract_session(path)
            self.assertIsNotNone(result)
            self.assertEqual(result["platform"], "openclaw")
            self.assertIn("metadata", result)
            self.assertIn("cost_by_model", result)
            self.assertIn("model_switches", result)
            self.assertIn("conversation", result)
            self.assertIn("tool_failures", result)
            self.assertIn("compactions", result)
            self.assertEqual(result["metadata"]["session_id"], "sess-001")

    def test_rejects_non_openclaw(self):
        """Files without a session header should return None."""
        records = [
            {"type": "user", "uuid": "aaa", "message": {"role": "user", "content": "hello"}},
        ]
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "claude.jsonl", records)
            result = extract_session(path)
            self.assertIsNone(result)

    def test_output_dir_mode(self):
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "sess-001.jsonl", records)
            out_dir = os.path.join(td, "output")
            result = extract_session(path, output_dir=out_dir)
            self.assertIsNotNone(result)
            main_json = os.path.join(out_dir, "main.json")
            self.assertTrue(os.path.isfile(main_json))
            with open(main_json) as f:
                loaded = json.load(f)
            self.assertEqual(loaded["platform"], "openclaw")
```

**Step 2: Run to verify failure**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py::TestExtractSession -v
```

**Step 3: Implement**

Add to `extract_session.py`:

```python
def is_openclaw_session(path):
    """Check if a JSONL file is an OpenClaw session by checking the first line for type=session."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    return False
                return rec.get("type") == "session" and "version" in rec
    except (OSError, IOError):
        return False
    return False


def extract_session(path, output_dir=None):
    """Full extraction pipeline for an OpenClaw session JSONL file.

    Returns None if the file is not an OpenClaw session.
    If output_dir is provided, writes main.json there.

    Returns dict with: platform, metadata, cost_by_model, model_switches,
    conversation, tool_failures, compactions.
    """
    if not is_openclaw_session(path):
        return None

    records = parse_jsonl(path)

    result = {
        "platform": "openclaw",
        "metadata": extract_metadata(records),
        "cost_by_model": extract_cost_by_model(records),
        "model_switches": extract_model_switches(records),
        "conversation": extract_conversation(records),
        "tool_failures": extract_tool_failures(records),
        "compactions": extract_compactions(records),
    }

    if output_dir:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        main_path = out / "main.json"
        with open(main_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"Written to {main_path}", file=sys.stderr)

    return result


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Extract structured signals from an OpenClaw session JSONL file."
    )
    parser.add_argument("session", help="Path to the session JSONL file")
    parser.add_argument("--output", "-o", help="Output path for JSON (default: stdout)", default=None)
    parser.add_argument("--output-dir", help="Output directory: writes main.json", default=None)
    args = parser.parse_args()

    if args.output and args.output_dir:
        print("Error: --output and --output-dir are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.session):
        print(f"Error: file not found: {args.session}", file=sys.stderr)
        sys.exit(1)

    result = extract_session(args.session, output_dir=args.output_dir)
    if result is None:
        print("Error: not an OpenClaw session file.", file=sys.stderr)
        sys.exit(1)

    if not args.output_dir:
        output_json = json.dumps(result, indent=2, ensure_ascii=False)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json + "\n")
            print(f"Written to {args.output}", file=sys.stderr)
        else:
            print(output_json)


if __name__ == "__main__":
    main()
```

**Step 4: Run all tests**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py -v
```

Expected: All PASS

**Step 5: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/extract_session.py skills/openclaw-session-analyst/scripts/test_extract.py
git commit -m "feat(openclaw-session-analyst): implement extract_session pipeline and CLI"
```

---

### Task 7: Implement search_sessions.py

**Files:**
- Create: `skills/openclaw-session-analyst/scripts/search_sessions.py`
- Create: `skills/openclaw-session-analyst/scripts/test_search.py`

**Step 1: Write the failing test**

Write `skills/openclaw-session-analyst/scripts/test_search.py`:

```python
#!/usr/bin/env python3
"""Tests for OpenClaw search_sessions.py."""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from search_sessions import count_turns, search_sessions, MAX_SESSIONS


def _write_openclaw_session(path, num_user_msgs=4):
    """Write a minimal OpenClaw session JSONL file."""
    with open(path, "w") as f:
        f.write(json.dumps({"type": "session", "version": 3, "id": Path(path).stem, "timestamp": "2026-03-02T00:00:00Z", "cwd": "/workspace"}) + "\n")
        for i in range(num_user_msgs):
            f.write(json.dumps({"type": "message", "id": f"u{i}", "message": {"role": "user", "content": [{"type": "text", "text": f"msg {i}"}], "timestamp": i}}) + "\n")
            f.write(json.dumps({"type": "message", "id": f"a{i}", "message": {"role": "assistant", "content": [{"type": "text", "text": f"reply {i}"}], "model": "m1", "provider": "p1", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"total": 0}}, "stopReason": "stop", "timestamp": i}}) + "\n")


class TestCountTurns(unittest.TestCase):
    def test_counts_user_messages(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "test.jsonl")
            _write_openclaw_session(path, num_user_msgs=5)
            self.assertEqual(count_turns(path), 5)

    def test_skips_tool_results(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "test.jsonl")
            with open(path, "w") as f:
                f.write(json.dumps({"type": "session", "version": 3, "id": "s1"}) + "\n")
                f.write(json.dumps({"type": "message", "id": "u1", "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}}) + "\n")
                f.write(json.dumps({"type": "message", "id": "tr1", "message": {"role": "toolResult", "toolName": "read"}}) + "\n")
            self.assertEqual(count_turns(path), 1)


class TestSearchSessions(unittest.TestCase):
    def _setup_agent_dir(self, td, agent="main", num_sessions=7, num_reset=2):
        """Create fake ~/.openclaw/agents/<agent>/sessions/ with JSONL files."""
        sessions_dir = os.path.join(td, ".openclaw", "agents", agent, "sessions")
        os.makedirs(sessions_dir)

        for i in range(num_sessions):
            path = os.path.join(sessions_dir, f"sess-{i:04d}.jsonl")
            _write_openclaw_session(path, num_user_msgs=4)
            os.utime(path, (time.time() - (num_sessions - i) * 100, time.time() - (num_sessions - i) * 100))

        # Add reset files (should be excluded by default)
        for i in range(num_reset):
            path = os.path.join(sessions_dir, f"sess-reset-{i}.jsonl.reset.2026-03-01T00-00-00Z")
            _write_openclaw_session(path, num_user_msgs=4)

        # Add a low-turn session
        low_path = os.path.join(sessions_dir, "sess-low.jsonl")
        with open(low_path, "w") as f:
            f.write(json.dumps({"type": "session", "version": 3, "id": "sess-low"}) + "\n")
            f.write(json.dumps({"type": "message", "id": "u1", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}}) + "\n")
        os.utime(low_path, (time.time(), time.time()))

        # Write sessions.json
        with open(os.path.join(sessions_dir, "sessions.json"), "w") as f:
            json.dump({}, f)

        return sessions_dir

    @patch.dict(os.environ, {"HOME": ""})
    def test_search_by_agent(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agent_dir(td, "main")
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=5, min_turns=3)
            self.assertEqual(len(results), 5)
            for r in results:
                self.assertGreaterEqual(r["turn_count"], 3)
                self.assertEqual(r["agent_id"], "main")

    @patch.dict(os.environ, {"HOME": ""})
    def test_excludes_reset_by_default(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agent_dir(td, "main", num_sessions=2, num_reset=3)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=100, min_turns=1)
            # Should only find the 2 active + 1 low-turn (excluded by min_turns default)
            for r in results:
                self.assertNotIn(".reset.", r["path"])

    @patch.dict(os.environ, {"HOME": ""})
    def test_include_reset(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agent_dir(td, "main", num_sessions=2, num_reset=3)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=100, min_turns=1, include_reset=True)
            paths = [r["path"] for r in results]
            has_reset = any(".reset." in p for p in paths)
            self.assertTrue(has_reset)

    @patch.dict(os.environ, {"HOME": ""})
    def test_search_all_agents(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agent_dir(td, "main", num_sessions=3)
            self._setup_agent_dir(td, "tool-runner", num_sessions=2)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(latest=100, min_turns=1)
            agents = set(r["agent_id"] for r in results)
            self.assertIn("main", agents)
            self.assertIn("tool-runner", agents)


if __name__ == "__main__":
    unittest.main()
```

**Step 2: Run to verify failure**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_search.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Write implementation**

Write `skills/openclaw-session-analyst/scripts/search_sessions.py`:

```python
#!/usr/bin/env python3
"""Search for OpenClaw session files by agent, date, and recency.

Searches ~/.openclaw/agents/<agentId>/sessions/ for session JSONL files.
Filters by agent, date range, turn count, and recency.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

MAX_SESSIONS = 20
DEFAULT_LATEST = 5
DEFAULT_MIN_TURNS = 3


def count_turns(jsonl_path):
    """Count user message turns in an OpenClaw session JSONL file.

    Counts entries where type="message" and message.role="user".
    Skips toolResult entries.
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
                if rec.get("type") != "message":
                    continue
                role = rec.get("message", {}).get("role")
                if role == "user":
                    count += 1
    except (OSError, IOError):
        return 0
    return count


def search_sessions(agent=None, since=None, date=None, latest=DEFAULT_LATEST,
                     min_turns=DEFAULT_MIN_TURNS, include_reset=False):
    """Search for OpenClaw session JSONL files.

    Args:
        agent: Agent ID to filter by (e.g., "main"). If None, searches all agents.
        since: Only sessions modified on/after this date (YYYY-MM-DD).
        date: Only sessions modified on this exact date (YYYY-MM-DD).
        latest: Max sessions to return (most recent first).
        min_turns: Exclude sessions with fewer than this many user turns.
        include_reset: If True, include .reset.* and .deleted.* files.

    Returns:
        List of dicts sorted by mtime (most recent first):
        [{"path", "session_id", "agent_id", "modified", "size_bytes", "turn_count"}, ...]
    """
    home = os.environ.get("HOME", os.path.expanduser("~"))
    agents_dir = Path(home) / ".openclaw" / "agents"

    if not agents_dir.is_dir():
        return []

    # Determine which agent directories to search
    if agent:
        search_dirs = [(agents_dir / agent / "sessions", agent)]
    else:
        search_dirs = []
        for d in agents_dir.iterdir():
            if d.is_dir():
                s = d / "sessions"
                if s.is_dir():
                    search_dirs.append((s, d.name))

    # Collect candidate session files
    candidates = []
    for sessions_dir, agent_id in search_dirs:
        if not sessions_dir.is_dir():
            continue
        for f in sessions_dir.iterdir():
            if not f.is_file():
                continue
            name = f.name
            # Skip sessions.json
            if name == "sessions.json":
                continue
            # Filter reset/deleted unless include_reset
            if not include_reset:
                if ".reset." in name or ".deleted." in name:
                    continue
            # Must have .jsonl somewhere in the name
            if ".jsonl" not in name:
                continue
            candidates.append((f, agent_id))

    # Stat and sort
    stat_cache = {}
    for f, _ in candidates:
        try:
            stat_cache[f] = f.stat()
        except OSError:
            pass

    candidates = [(f, a) for f, a in candidates if f in stat_cache]

    # Filter by date
    if since:
        since_dt = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        candidates = [(f, a) for f, a in candidates
                       if datetime.fromtimestamp(stat_cache[f].st_mtime, tz=timezone.utc) >= since_dt]

    if date:
        date_dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        date_end = date_dt + timedelta(days=1)
        candidates = [(f, a) for f, a in candidates
                       if date_dt <= datetime.fromtimestamp(stat_cache[f].st_mtime, tz=timezone.utc) < date_end]

    # Sort by mtime (most recent first)
    candidates.sort(key=lambda x: stat_cache[x[0]].st_mtime, reverse=True)

    # Build results with turn count filter
    results = []
    for f, agent_id in candidates:
        if len(results) >= min(latest, MAX_SESSIONS):
            break
        turns = count_turns(str(f))
        if turns < min_turns:
            continue
        st = stat_cache[f]
        # Extract session_id: the UUID part before .jsonl
        session_id = f.name.split(".jsonl")[0]
        results.append({
            "path": str(f),
            "session_id": session_id,
            "agent_id": agent_id,
            "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
            "size_bytes": st.st_size,
            "turn_count": turns,
        })

    return results


def main():
    parser = argparse.ArgumentParser(description="Search for OpenClaw session files.")
    parser.add_argument("--agent", help="Agent ID to filter by (e.g., 'main')")
    parser.add_argument("--since", help="Only sessions modified on/after this date (YYYY-MM-DD)")
    parser.add_argument("--date", help="Only sessions modified on this date (YYYY-MM-DD)")
    parser.add_argument("--latest", type=int, default=DEFAULT_LATEST,
                        help=f"Max sessions to return (default: {DEFAULT_LATEST}, hard cap: {MAX_SESSIONS})")
    parser.add_argument("--min-turns", type=int, default=DEFAULT_MIN_TURNS,
                        help=f"Min user turns to include (default: {DEFAULT_MIN_TURNS})")
    parser.add_argument("--include-reset", action="store_true",
                        help="Include .reset.* and .deleted.* session files")
    args = parser.parse_args()

    results = search_sessions(
        agent=args.agent,
        since=args.since,
        date=args.date,
        latest=args.latest,
        min_turns=args.min_turns,
        include_reset=args.include_reset,
    )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
```

**Step 4: Run tests**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_search.py -v
```

Expected: All PASS

**Step 5: Commit**

```bash
git add skills/openclaw-session-analyst/scripts/search_sessions.py skills/openclaw-session-analyst/scripts/test_search.py
git commit -m "feat(openclaw-session-analyst): implement search_sessions with agent/date/reset filters"
```

---

### Task 8: Write SKILL.md

**Files:**
- Create: `skills/openclaw-session-analyst/SKILL.md`

**Step 1: Write SKILL.md**

```markdown
---
name: openclaw-session-analyst
description: "Use when the user wants to review past OpenClaw sessions, analyze cost efficiency, identify anti-patterns, or review model switching behavior. Triggers: 'review openclaw session', 'openclaw session review', 'analyze openclaw sessions', 'openclaw cost analysis', 'openclaw retrospective'."
---

# OpenClaw Session Analyst

Orchestrate OpenClaw session transcript analysis to produce a self-improvement and cost-efficiency report. Dispatch cheap/fast subagents for analysis work, then synthesize their findings into one unified report.

Does NOT modify skill files — observe, analyze, and report only.

## Process

- [ ] 1. Search for sessions
- [ ] 2. Preprocess each session
- [ ] 3. Dispatch analysis subagents
- [ ] 4. Synthesize report

### 1. Search for Sessions

Determine target sessions from user input. Use the bundled search script:

\```bash
python3 <skill-dir>/scripts/search_sessions.py --agent main --latest 5 --min-turns 3
\```

Where `<skill-dir>` is the directory containing this SKILL.md.

**Argument mapping:**
- "review this session" / "last session" → `--latest 1`
- "review last N sessions" → `--latest N`
- "review today's sessions" → `--date YYYY-MM-DD`
- "review sessions since Monday" → `--since YYYY-MM-DD`
- "review tool-runner agent" → `--agent tool-runner`
- No argument → `--agent main --latest 5` (default)

The script returns a JSON array of session objects with `path`, `session_id`, `agent_id`, `modified`, `size_bytes`, and `turn_count`.

### 2. Preprocess Each Session

For each session path from step 1, extract condensed data:

\```bash
python3 <skill-dir>/scripts/extract_session.py <session.jsonl> --output-dir /tmp/openclaw-session-analyst/<session-id>/
\```

This creates:
\```
/tmp/openclaw-session-analyst/<session-id>/
└── main.json              # Condensed session data with cost tracking
\```

### 3. Dispatch Analysis Subagents

For each `main.json`, dispatch one analysis subagent.

**Before dispatching**, read `<skill-dir>/../session-subagent-analyst/SKILL.md` once and store its full body. Include this content in every subagent prompt.

Use the Agent tool with:
- `subagent_type`: `"general-purpose"`
- `model`: Pick a model that can follow a checklist and produce structured JSON output.
- `description`: `"Analyze openclaw session <session-id>"`
- `prompt`: Include the file path, context, and the full sub-skill instructions:

\```
Analyze the OpenClaw session transcript at: <path to main.json>

Context: This is an OpenClaw session analysis (not Claude Code). The condensed JSON includes
OpenClaw-specific fields: cost_by_model, model_switches, and cost-per-turn on assistant messages.
Pay special attention to cost efficiency and model switching patterns.

<paste full session-subagent-analyst SKILL.md body here>
\```

Dispatch all subagents in parallel. Collect all JSON reports.

### 4. Synthesize Report

Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `docs/reviews/YYYY-MM-DD-openclaw-sessions-review.md`.

**Merge rules:**
- **Cost Analysis**: Aggregate cost_by_model across sessions. Identify most/least expensive sessions.
- **Anti-patterns**: Group by pattern name. Count occurrences across sessions.
- **User Preferences**: Only promote if observed in 2+ sessions.
- **Gaps**: Deduplicate. Note frequency.
- **Attribution**: Use `task_label` from subagent reports — never raw session IDs.

## Report Template

\```markdown
# OpenClaw Session Analysis Report
**Date**: YYYY-MM-DD | **Sessions analyzed**: N | **Agent**: <agent-id>

---

## 1. Cost Analysis

| Model | Sessions | Turns | Input | Output | Cache | Total |
|-------|----------|-------|-------|--------|-------|-------|
| <model-id> | N | N | $X.XX | $X.XX | $X.XX | $X.XX |

**Total cost across sessions**: $X.XX
**Model switching patterns**: <observations about when/why models were switched>
**Cost efficiency**: <recommendations>

---

## 2. Anti-patterns

**<pattern-name>**: <description>
- Observed in: <N>/<total> sessions
- Impact: <time/tokens/cost>
- Recommendation: <fix>

(Omit entire section if none found.)

---

## 3. User Preferences

| Preference | Scope | Frequency | Suggested Entry |
|-----------|-------|-----------|----------------|
| <pattern> | Global/Project | <N>/<total> sessions | <what to add to config or memory> |

(Omit entire section if none found.)

---

## 4. Gaps

**<gap-name>**: <situation>
- Observed in: <N>/<total> sessions
- Proposed skill: <name and description>

(Omit entire section if none found.)

---

## 5. Tool Usage

| Tool | Calls | Failures | Failure Rate |
|------|-------|----------|--------------|
| <name> | N | N | N% |

(Omit if no notable findings.)
\```

## Quality Standards

- **Non-trivial only.** Skip obvious observations.
- **Be specific.** "Model switched to deepseek mid-conversation without apparent reason" > "model switching observed."
- **Cost awareness.** Flag sessions where >50% of cost was cache writes that were never read.
- **Cross-session patterns matter most.** Single-session findings are less actionable.
```

**Step 2: Commit**

```bash
git add skills/openclaw-session-analyst/SKILL.md
git commit -m "feat(openclaw-session-analyst): add SKILL.md with full analysis pipeline"
```

---

### Task 9: Integration test with real data

**Files:** None created — manual validation only

**Step 1: Copy a real session file from remote for testing**

```bash
scp meixueting@100.122.191.42:~/.openclaw/agents/main/sessions/337b69a1-c396-4966-b64e-c31989ae752d.jsonl /tmp/openclaw-test-session.jsonl
```

**Step 2: Run extract on real data**

```bash
cd skills/openclaw-session-analyst/scripts && python3 extract_session.py /tmp/openclaw-test-session.jsonl --output-dir /tmp/openclaw-session-analyst/337b69a1/
```

Expected: Creates `/tmp/openclaw-session-analyst/337b69a1/main.json` with valid JSON

**Step 3: Verify output schema**

```bash
python3 -c "
import json
with open('/tmp/openclaw-session-analyst/337b69a1/main.json') as f:
    data = json.load(f)
print('platform:', data['platform'])
print('session_id:', data['metadata']['session_id'])
print('models:', data['metadata']['models_used'])
print('total_cost:', data['metadata']['total_cost'])
print('turns:', data['metadata']['turn_count'])
print('cost_by_model:', json.dumps(data['cost_by_model'], indent=2))
print('model_switches:', len(data['model_switches']))
print('conversation entries:', len(data['conversation']))
print('tool_failures:', len(data['tool_failures']))
print('compactions:', len(data['compactions']))
"
```

Expected: All fields populated, cost > 0, models_used has entries

**Step 4: Run all tests one final time**

```bash
cd skills/openclaw-session-analyst/scripts && python3 -m pytest test_extract.py test_search.py -v
```

Expected: All PASS

**Step 5: Final commit if any fixes were needed**

```bash
git add -A skills/openclaw-session-analyst/
git commit -m "feat(openclaw-session-analyst): complete skill with search, extract, and analysis pipeline"
```
