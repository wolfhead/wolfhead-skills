#!/usr/bin/env python3
"""Comprehensive tests for OpenClaw extract_session.py."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure the module can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_session import (
    parse_jsonl,
    classify_entry,
    is_openclaw_session,
    extract_metadata,
    extract_cost_by_model,
    extract_model_switches,
    extract_conversation,
    extract_tool_failures,
    extract_compactions,
    extract_session,
    CONTENT_PREVIEW_MAX_CHARS,
)


def _write_jsonl(tmpdir, filename, records):
    """Helper: write a list of dicts as JSONL to a file, return the path."""
    path = os.path.join(tmpdir, filename)
    with open(path, "w") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    return path


def _make_session_header(**overrides):
    """Create an OpenClaw session header entry."""
    base = {
        "type": "session",
        "version": 3,
        "id": "1a3870de-6722-430c-8c2b-709f4fb9a0f9",
        "timestamp": "2026-03-03T12:53:06.027Z",
        "cwd": "/Users/me/.openclaw/workspace",
    }
    base.update(overrides)
    return base


def _make_user_message(text="Hello", msg_id="8c9cb00a", parent_id="a625ffa9",
                       timestamp="2026-03-02T00:24:52.273Z"):
    """Create an OpenClaw user message entry."""
    return {
        "type": "message",
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": text}],
            "timestamp": 1772411092269,
        },
    }


def _make_assistant_message(text="Here is my response", msg_id="6de88ac8",
                            parent_id="8c9cb00a",
                            timestamp="2026-03-03T12:53:09.955Z",
                            model="claude-sonnet-4-5-20250929",
                            provider="jiekou-sonnet",
                            tool_calls=None,
                            cost=None, usage=None):
    """Create an OpenClaw assistant message entry."""
    content = []
    if text:
        content.append({"type": "text", "text": text})
    if tool_calls:
        content.extend(tool_calls)
    if cost is None:
        cost = {
            "input": 9e-06,
            "output": 0.00126,
            "cacheRead": 0,
            "cacheWrite": 0.0585225,
            "total": 0.0597915,
        }
    if usage is None:
        usage = {
            "input": 3,
            "output": 84,
            "cacheRead": 0,
            "cacheWrite": 15606,
            "totalTokens": 15693,
            "cost": cost,
        }
    return {
        "type": "message",
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
        "message": {
            "role": "assistant",
            "content": content,
            "api": "anthropic-messages",
            "provider": provider,
            "model": model,
            "usage": usage,
            "stopReason": "stop",
            "timestamp": 1772542386032,
        },
    }


def _make_tool_result(tool_call_id="toolu_bdrk_019apiUh3MLUKNQK95aM5WX5",
                      tool_name="read", is_error=False, content_text="file contents",
                      msg_id="d9280a7c", parent_id="6de88ac8",
                      timestamp="2026-03-02T00:24:56.888Z",
                      details=None):
    """Create an OpenClaw tool result entry."""
    entry = {
        "type": "message",
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
        "message": {
            "role": "toolResult",
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "content": [{"type": "text", "text": content_text}],
            "isError": is_error,
            "timestamp": 1772411096883,
        },
    }
    if details is not None:
        entry["message"]["details"] = details
    return entry


def _make_model_change(model_id="claude-sonnet-4-5-20250929", provider="jiekou-sonnet",
                       msg_id="290ff222", parent_id=None,
                       timestamp="2026-03-03T12:53:06.027Z"):
    """Create an OpenClaw model_change entry."""
    return {
        "type": "model_change",
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
        "provider": provider,
        "modelId": model_id,
    }


def _make_thinking_level_change(level="off", msg_id="9c143795", parent_id="290ff222",
                                timestamp="2026-03-03T12:53:06.027Z"):
    """Create an OpenClaw thinking_level_change entry."""
    return {
        "type": "thinking_level_change",
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
        "thinkingLevel": level,
    }


def _make_custom(custom_type="model-snapshot", data=None,
                 msg_id="9bba9116", parent_id="9c143795",
                 timestamp="2026-03-03T12:53:06.028Z"):
    """Create an OpenClaw custom entry."""
    if data is None:
        data = {
            "timestamp": 1772542386028,
            "provider": "jiekou-opus",
            "modelApi": "anthropic-messages",
            "modelId": "claude-opus-4-5-20251101",
        }
    return {
        "type": "custom",
        "customType": custom_type,
        "data": data,
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
    }


def _make_compaction(summary="## Goal\nDo something...",
                     tokens_before=52575,
                     msg_id="b7c55d1f", parent_id="49990448",
                     timestamp="2026-03-02T07:31:28.099Z",
                     read_files=None, modified_files=None,
                     from_hook=True):
    """Create an OpenClaw compaction entry."""
    return {
        "type": "compaction",
        "id": msg_id,
        "parentId": parent_id,
        "timestamp": timestamp,
        "summary": summary,
        "firstKeptEntryId": "15ecf359",
        "tokensBefore": tokens_before,
        "details": {
            "readFiles": read_files or ["/path/to/MEMORY.md"],
            "modifiedFiles": modified_files or [],
        },
        "fromHook": from_hook,
    }


def _make_session_records():
    """Create a realistic set of OpenClaw session records."""
    return [
        _make_session_header(),
        _make_model_change(
            model_id="claude-sonnet-4-5-20250929",
            provider="jiekou-sonnet",
            msg_id="290ff222",
            timestamp="2026-03-03T12:53:06.027Z",
        ),
        _make_thinking_level_change(level="off", msg_id="9c143795", parent_id="290ff222"),
        _make_custom(),
        _make_user_message(text="What files are in the current directory?",
                           msg_id="efc83c92", parent_id=None,
                           timestamp="2026-03-03T12:53:08.000Z"),
        _make_assistant_message(
            text="Let me check that for you.",
            msg_id="6de88ac8",
            parent_id="efc83c92",
            timestamp="2026-03-03T12:53:09.955Z",
            model="claude-sonnet-4-5-20250929",
            provider="jiekou-sonnet",
            tool_calls=[{
                "type": "toolCall",
                "id": "toolu_bdrk_001",
                "name": "exec",
                "arguments": {"command": "ls"},
            }],
        ),
        _make_tool_result(
            tool_call_id="toolu_bdrk_001",
            tool_name="exec",
            content_text="file1.txt\nfile2.txt",
            msg_id="d9280a7c",
            parent_id="6de88ac8",
            timestamp="2026-03-03T12:53:10.500Z",
        ),
        _make_assistant_message(
            text="The directory contains file1.txt and file2.txt.",
            msg_id="a1b2c3d4",
            parent_id="d9280a7c",
            timestamp="2026-03-03T12:53:12.000Z",
            model="claude-sonnet-4-5-20250929",
            provider="jiekou-sonnet",
            tool_calls=None,
        ),
    ]


# =========================================================================
# Task 1 — parse_jsonl + classify_entry
# =========================================================================


class TestParseJsonl(unittest.TestCase):
    def test_basic(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "test.jsonl", [
                _make_session_header(),
                _make_user_message(),
            ])
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)
            self.assertEqual(records[0]["type"], "session")

    def test_skip_malformed(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "test.jsonl")
            with open(path, "w") as f:
                f.write('{"type": "session", "version": 3}\n')
                f.write("NOT JSON\n")
                f.write('{"type": "message"}\n')
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "empty.jsonl")
            with open(path, "w") as f:
                f.write("")
            records = parse_jsonl(path)
            self.assertEqual(records, [])

    def test_blank_lines_skipped(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "blanks.jsonl")
            with open(path, "w") as f:
                f.write('{"a": 1}\n\n\n{"b": 2}\n')
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)


class TestClassifyEntry(unittest.TestCase):
    def test_session_header(self):
        self.assertEqual(classify_entry(_make_session_header()), "session_header")

    def test_human_message(self):
        self.assertEqual(classify_entry(_make_user_message()), "human_message")

    def test_assistant(self):
        self.assertEqual(classify_entry(_make_assistant_message()), "assistant")

    def test_tool_result(self):
        self.assertEqual(classify_entry(_make_tool_result()), "tool_result")

    def test_model_change(self):
        self.assertEqual(classify_entry(_make_model_change()), "model_change")

    def test_thinking_level_change(self):
        self.assertEqual(classify_entry(_make_thinking_level_change()), "thinking_level_change")

    def test_custom(self):
        self.assertEqual(classify_entry(_make_custom()), "custom")

    def test_compaction(self):
        self.assertEqual(classify_entry(_make_compaction()), "compaction")

    def test_unknown_type(self):
        self.assertEqual(classify_entry({"type": "foobar"}), "skip")

    def test_no_type(self):
        self.assertEqual(classify_entry({"foo": "bar"}), "skip")


# =========================================================================
# Task 2 — extract_metadata
# =========================================================================


class TestExtractMetadata(unittest.TestCase):
    def test_basic_metadata(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["session_id"], "1a3870de-6722-430c-8c2b-709f4fb9a0f9")
        self.assertEqual(meta["cwd"], "/Users/me/.openclaw/workspace")
        self.assertEqual(meta["first_timestamp"], "2026-03-03T12:53:06.027Z")
        self.assertEqual(meta["last_timestamp"], "2026-03-03T12:53:12.000Z")
        self.assertIn("claude-sonnet-4-5-20250929", meta["models_used"])
        self.assertIn("jiekou-sonnet", meta["providers_used"])
        self.assertEqual(meta["turn_count"], 2)  # 2 assistant messages

    def test_total_cost(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        # 2 assistant messages each with total=0.0597915
        self.assertAlmostEqual(meta["total_cost"], 0.0597915 * 2, places=6)

    def test_token_counts(self):
        records = _make_session_records()
        meta = extract_metadata(records)
        # 2 assistant messages each with input=3, output=84, cacheRead=0, cacheWrite=15606
        self.assertEqual(meta["input_tokens"], 6)
        self.assertEqual(meta["output_tokens"], 168)
        self.assertEqual(meta["cache_read_tokens"], 0)
        self.assertEqual(meta["cache_write_tokens"], 31212)

    def test_empty_records(self):
        meta = extract_metadata([])
        self.assertIsNone(meta["session_id"])
        self.assertEqual(meta["total_cost"], 0)
        self.assertEqual(meta["turn_count"], 0)

    def test_multiple_models(self):
        records = [
            _make_session_header(),
            _make_assistant_message(model="model-a", provider="prov-a",
                                    msg_id="aaa", timestamp="2026-03-03T12:00:00Z"),
            _make_assistant_message(model="model-b", provider="prov-b",
                                    msg_id="bbb", timestamp="2026-03-03T13:00:00Z"),
        ]
        meta = extract_metadata(records)
        self.assertEqual(sorted(meta["models_used"]), ["model-a", "model-b"])
        self.assertEqual(sorted(meta["providers_used"]), ["prov-a", "prov-b"])

    def test_channel_and_chat_type_from_session_header(self):
        """Metadata should include channel/chat_type if present in session header."""
        # These fields come from sessions.json, not the JSONL header itself,
        # so extract_metadata returns None when not present.
        records = [_make_session_header()]
        meta = extract_metadata(records)
        self.assertIsNone(meta["channel"])
        self.assertIsNone(meta["chat_type"])


# =========================================================================
# Task 3 — cost_by_model + model_switches
# =========================================================================


class TestExtractCostByModel(unittest.TestCase):
    def test_single_model(self):
        records = _make_session_records()
        costs = extract_cost_by_model(records)
        self.assertIn("claude-sonnet-4-5-20250929", costs)
        entry = costs["claude-sonnet-4-5-20250929"]
        self.assertEqual(entry["turn_count"], 2)
        self.assertAlmostEqual(entry["total"], 0.0597915 * 2, places=6)

    def test_multiple_models(self):
        records = [
            _make_session_header(),
            _make_assistant_message(
                model="model-a", provider="prov-a", msg_id="aaa",
                cost={"input": 0.01, "output": 0.02, "cacheRead": 0, "cacheWrite": 0, "total": 0.03},
                usage={"input": 10, "output": 20, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 30,
                       "cost": {"input": 0.01, "output": 0.02, "cacheRead": 0, "cacheWrite": 0, "total": 0.03}},
            ),
            _make_assistant_message(
                model="model-b", provider="prov-b", msg_id="bbb",
                cost={"input": 0.05, "output": 0.06, "cacheRead": 0.01, "cacheWrite": 0, "total": 0.12},
                usage={"input": 50, "output": 60, "cacheRead": 10, "cacheWrite": 0, "totalTokens": 120,
                       "cost": {"input": 0.05, "output": 0.06, "cacheRead": 0.01, "cacheWrite": 0, "total": 0.12}},
            ),
        ]
        costs = extract_cost_by_model(records)
        self.assertIn("model-a", costs)
        self.assertIn("model-b", costs)
        self.assertEqual(costs["model-a"]["turn_count"], 1)
        self.assertEqual(costs["model-b"]["turn_count"], 1)
        self.assertAlmostEqual(costs["model-a"]["total"], 0.03)
        self.assertAlmostEqual(costs["model-b"]["total"], 0.12)

    def test_empty_records(self):
        costs = extract_cost_by_model([])
        self.assertEqual(costs, {})


class TestExtractModelSwitches(unittest.TestCase):
    def test_no_switches(self):
        records = [_make_session_header()]
        switches = extract_model_switches(records)
        self.assertEqual(switches, [])

    def test_single_switch(self):
        records = [
            _make_session_header(),
            _make_assistant_message(text="first", model="claude-sonnet-4-5-20250929",
                                    provider="jiekou-sonnet", msg_id="a1",
                                    timestamp="2026-03-03T12:00:00Z"),
            _make_assistant_message(text="second", model="claude-opus-4-5-20251101",
                                    provider="jiekou-opus", msg_id="a2",
                                    timestamp="2026-03-03T13:00:00Z"),
        ]
        switches = extract_model_switches(records)
        self.assertEqual(len(switches), 1)
        self.assertEqual(switches[0]["from_model"], "claude-sonnet-4-5-20250929")
        self.assertEqual(switches[0]["to_model"], "claude-opus-4-5-20251101")
        self.assertEqual(switches[0]["from_provider"], "jiekou-sonnet")
        self.assertEqual(switches[0]["to_provider"], "jiekou-opus")
        self.assertEqual(switches[0]["timestamp"], "2026-03-03T13:00:00Z")

    def test_no_switch_same_model(self):
        records = [
            _make_session_header(),
            _make_assistant_message(text="first", model="model-a", provider="prov-a",
                                    msg_id="a1", timestamp="T1"),
            _make_assistant_message(text="second", model="model-a", provider="prov-a",
                                    msg_id="a2", timestamp="T2"),
        ]
        switches = extract_model_switches(records)
        self.assertEqual(switches, [])

    def test_multiple_switches(self):
        records = [
            _make_session_header(),
            _make_assistant_message(text="a", model="model-a", provider="prov-a",
                                    msg_id="a1", timestamp="2026-03-03T12:00:00Z"),
            _make_assistant_message(text="b", model="model-b", provider="prov-b",
                                    msg_id="a2", timestamp="2026-03-03T13:00:00Z"),
            _make_assistant_message(text="c", model="model-c", provider="prov-c",
                                    msg_id="a3", timestamp="2026-03-03T14:00:00Z"),
        ]
        switches = extract_model_switches(records)
        self.assertEqual(len(switches), 2)
        self.assertEqual(switches[0]["from_model"], "model-a")
        self.assertEqual(switches[0]["to_model"], "model-b")
        self.assertEqual(switches[1]["from_model"], "model-b")
        self.assertEqual(switches[1]["to_model"], "model-c")


# =========================================================================
# Task 4 — extract_conversation
# =========================================================================


class TestExtractConversation(unittest.TestCase):
    def test_basic_conversation(self):
        records = _make_session_records()
        conv = extract_conversation(records)
        # Should have: human_message, assistant_turn (with tool call), tool_result, assistant_turn
        types = [t["type"] for t in conv]
        self.assertEqual(types, ["human_message", "assistant_turn", "tool_result", "assistant_turn"])

    def test_human_message_text(self):
        records = _make_session_records()
        conv = extract_conversation(records)
        human = conv[0]
        self.assertEqual(human["type"], "human_message")
        self.assertEqual(human["text"], "What files are in the current directory?")

    def test_assistant_turn_with_tool_call(self):
        records = _make_session_records()
        conv = extract_conversation(records)
        assistant = conv[1]
        self.assertEqual(assistant["type"], "assistant_turn")
        self.assertIn("Let me check", assistant["text"])
        self.assertEqual(len(assistant["tool_calls"]), 1)
        self.assertEqual(assistant["tool_calls"][0]["name"], "exec")
        self.assertEqual(assistant["model"], "claude-sonnet-4-5-20250929")
        self.assertEqual(assistant["provider"], "jiekou-sonnet")

    def test_tool_result(self):
        records = _make_session_records()
        conv = extract_conversation(records)
        tr = conv[2]
        self.assertEqual(tr["type"], "tool_result")
        self.assertEqual(tr["tool_call_id"], "toolu_bdrk_001")
        self.assertEqual(tr["tool_name"], "exec")
        self.assertFalse(tr["is_error"])

    def test_sender_extraction(self):
        """Extract sender from untrusted metadata block in user messages."""
        text = (
            'Sender (untrusted metadata):\n'
            '```json\n'
            '{"label": "Jojo Wolf", "name": "Jojo Wolf", "username": "realjojowolf"}\n'
            '```\n\n'
            'Hello there!'
        )
        records = [
            _make_session_header(),
            _make_user_message(text=text),
        ]
        conv = extract_conversation(records)
        self.assertEqual(conv[0]["sender"], "Jojo Wolf")

    def test_sender_none_when_absent(self):
        records = [
            _make_session_header(),
            _make_user_message(text="Just a plain message"),
        ]
        conv = extract_conversation(records)
        self.assertIsNone(conv[0]["sender"])

    def test_assistant_cost(self):
        records = _make_session_records()
        conv = extract_conversation(records)
        assistant = conv[1]
        self.assertAlmostEqual(assistant["cost"], 0.0597915)

    def test_content_preview_truncation(self):
        long_text = "x" * 1000
        records = [
            _make_session_header(),
            _make_tool_result(content_text=long_text),
        ]
        conv = extract_conversation(records)
        tr = conv[0]
        self.assertLessEqual(len(tr["content_preview"]), CONTENT_PREVIEW_MAX_CHARS + 3)  # +3 for "..."

    def test_empty_records(self):
        conv = extract_conversation([])
        self.assertEqual(conv, [])


# =========================================================================
# Task 5 — tool_failures + compactions
# =========================================================================


class TestExtractToolFailures(unittest.TestCase):
    def test_is_error_true(self):
        records = [
            _make_session_header(),
            _make_tool_result(
                is_error=True,
                tool_name="read",
                tool_call_id="toolu_err_1",
                content_text="ENOENT: no such file",
            ),
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["tool_call_id"], "toolu_err_1")
        self.assertEqual(failures[0]["tool_name"], "read")
        self.assertIn("ENOENT", failures[0]["content_preview"])

    def test_details_status_error(self):
        records = [
            _make_session_header(),
            _make_tool_result(
                is_error=False,
                tool_name="read",
                tool_call_id="toolu_err_2",
                content_text='{"status": "error", "error": "permission denied"}',
                details={"status": "error", "tool": "read", "error": "permission denied"},
            ),
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["tool_call_id"], "toolu_err_2")

    def test_no_failures(self):
        records = [
            _make_session_header(),
            _make_tool_result(is_error=False, content_text="success"),
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(failures, [])

    def test_both_error_types(self):
        records = [
            _make_session_header(),
            _make_tool_result(
                is_error=True, tool_call_id="err1", tool_name="exec",
                content_text="command failed", msg_id="aa",
            ),
            _make_tool_result(
                is_error=False, tool_call_id="err2", tool_name="read",
                content_text="error content", msg_id="bb",
                details={"status": "error", "error": "denied"},
            ),
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(len(failures), 2)


class TestExtractCompactions(unittest.TestCase):
    def test_basic_compaction(self):
        records = [
            _make_session_header(),
            _make_compaction(
                summary="## Goal\nResearch methods...",
                tokens_before=52575,
                read_files=["/path/to/MEMORY.md"],
                modified_files=[],
                from_hook=True,
            ),
        ]
        compactions = extract_compactions(records)
        self.assertEqual(len(compactions), 1)
        c = compactions[0]
        self.assertEqual(c["tokens_before"], 52575)
        self.assertIn("Research methods", c["summary_preview"])
        self.assertEqual(c["read_files"], ["/path/to/MEMORY.md"])
        self.assertEqual(c["modified_files"], [])
        self.assertTrue(c["from_hook"])
        self.assertEqual(c["timestamp"], "2026-03-02T07:31:28.099Z")

    def test_no_compactions(self):
        records = [_make_session_header()]
        compactions = extract_compactions(records)
        self.assertEqual(compactions, [])

    def test_summary_preview_truncation(self):
        long_summary = "x" * 1000
        records = [
            _make_session_header(),
            _make_compaction(summary=long_summary),
        ]
        compactions = extract_compactions(records)
        self.assertLessEqual(len(compactions[0]["summary_preview"]),
                             CONTENT_PREVIEW_MAX_CHARS + 3)


# =========================================================================
# Task 6 — is_openclaw_session + extract_session pipeline + CLI
# =========================================================================


class TestIsOpenclawSession(unittest.TestCase):
    def test_valid_openclaw(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [_make_session_header()])
            self.assertTrue(is_openclaw_session(path))

    def test_not_openclaw_no_version(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [
                {"type": "session", "id": "abc"},  # no "version"
            ])
            self.assertFalse(is_openclaw_session(path))

    def test_not_openclaw_different_type(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [
                {"type": "user", "message": {"content": "hi"}},
            ])
            self.assertFalse(is_openclaw_session(path))

    def test_claude_code_session(self):
        """Claude Code sessions don't have type=session with version."""
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [
                {"type": "user", "sessionId": "abc-123", "message": {"role": "user"}},
            ])
            self.assertFalse(is_openclaw_session(path))

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "empty.jsonl")
            with open(path, "w") as f:
                f.write("")
            self.assertFalse(is_openclaw_session(path))

    def test_nonexistent_file(self):
        self.assertFalse(is_openclaw_session("/nonexistent/file.jsonl"))


class TestExtractSession(unittest.TestCase):
    def test_full_pipeline(self):
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", records)
            result = extract_session(path)
            self.assertIsNotNone(result)
            self.assertEqual(result["platform"], "openclaw")
            self.assertIn("metadata", result)
            self.assertIn("cost_by_model", result)
            self.assertIn("model_switches", result)
            self.assertIn("conversation", result)
            self.assertIn("tool_failures", result)
            self.assertIn("compactions", result)

    def test_returns_none_for_non_openclaw(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [
                {"type": "user", "message": {"content": "hi"}},
            ])
            result = extract_session(path)
            self.assertIsNone(result)

    def test_output_dir_writes_main_json(self):
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", records)
            out_dir = os.path.join(td, "output")
            result = extract_session(path, output_dir=out_dir)
            self.assertIsNotNone(result)
            main_json = os.path.join(out_dir, "main.json")
            self.assertTrue(os.path.exists(main_json))
            with open(main_json) as f:
                data = json.load(f)
            self.assertEqual(data["platform"], "openclaw")

    def test_metadata_structure(self):
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", records)
            result = extract_session(path)
            meta = result["metadata"]
            self.assertIn("session_id", meta)
            self.assertIn("models_used", meta)
            self.assertIn("providers_used", meta)
            self.assertIn("total_cost", meta)
            self.assertIn("turn_count", meta)


class TestMainCLI(unittest.TestCase):
    def test_stdout_output(self):
        """CLI should print JSON to stdout when no --output/--output-dir."""
        import subprocess
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", records)
            script = os.path.join(os.path.dirname(__file__), "extract_session.py")
            proc = subprocess.run(
                [sys.executable, script, path],
                capture_output=True, text=True,
            )
            self.assertEqual(proc.returncode, 0)
            data = json.loads(proc.stdout)
            self.assertEqual(data["platform"], "openclaw")

    def test_output_file(self):
        import subprocess
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", records)
            out_path = os.path.join(td, "result.json")
            script = os.path.join(os.path.dirname(__file__), "extract_session.py")
            proc = subprocess.run(
                [sys.executable, script, path, "--output", out_path],
                capture_output=True, text=True,
            )
            self.assertEqual(proc.returncode, 0)
            self.assertTrue(os.path.exists(out_path))

    def test_output_dir(self):
        import subprocess
        records = _make_session_records()
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", records)
            out_dir = os.path.join(td, "out")
            script = os.path.join(os.path.dirname(__file__), "extract_session.py")
            proc = subprocess.run(
                [sys.executable, script, path, "--output-dir", out_dir],
                capture_output=True, text=True,
            )
            self.assertEqual(proc.returncode, 0)
            self.assertTrue(os.path.exists(os.path.join(out_dir, "main.json")))

    def test_non_openclaw_file_errors(self):
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [{"type": "user"}])
            script = os.path.join(os.path.dirname(__file__), "extract_session.py")
            proc = subprocess.run(
                [sys.executable, script, path],
                capture_output=True, text=True,
            )
            self.assertNotEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main()
