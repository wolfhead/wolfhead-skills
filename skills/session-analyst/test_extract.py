#!/usr/bin/env python3
"""Comprehensive tests for extract_session.py."""

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
    classify_record,
    is_main_session,
    extract_metadata,
    extract_conversation,
    extract_skills,
    extract_subagents,
    extract_tool_failures,
    extract_api_errors,
    extract_compactions,
    find_subagent_files,
    extract_session,
)


def _write_jsonl(tmpdir, filename, records):
    """Helper: write a list of dicts as JSONL to a file, return the path."""
    path = os.path.join(tmpdir, filename)
    with open(path, "w") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    return path


# =========================================================================
# Task 2 — Core parser tests
# =========================================================================


class TestParseJsonl(unittest.TestCase):
    def test_basic(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "test.jsonl", [
                {"type": "user", "message": {"content": "hello"}},
                {"type": "assistant", "message": {"id": "msg_1"}},
            ])
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)
            self.assertEqual(records[0]["type"], "user")

    def test_skip_malformed(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "test.jsonl")
            with open(path, "w") as f:
                f.write('{"type": "user"}\n')
                f.write("this is not json\n")
                f.write('{"type": "assistant"}\n')
                f.write("\n")  # blank line
                f.write("{broken json\n")
            records = parse_jsonl(path)
            self.assertEqual(len(records), 2)

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "empty.jsonl")
            with open(path, "w") as f:
                pass
            records = parse_jsonl(path)
            self.assertEqual(records, [])


class TestClassifyRecord(unittest.TestCase):
    def test_human_message(self):
        rec = {"type": "user", "message": {"role": "user", "content": "hello"}}
        self.assertEqual(classify_record(rec), "human_message")

    def test_tool_result(self):
        rec = {"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_1", "content": "ok", "is_error": False}
        ]}}
        self.assertEqual(classify_record(rec), "tool_result")

    def test_assistant(self):
        rec = {"type": "assistant", "message": {"id": "msg_1", "content": [{"type": "text", "text": "hi"}]}}
        self.assertEqual(classify_record(rec), "assistant")

    def test_agent_progress(self):
        rec = {"type": "progress", "data": {"type": "agent_progress"}}
        self.assertEqual(classify_record(rec), "agent_progress")

    def test_bash_progress(self):
        rec = {"type": "progress", "data": {"type": "bash_progress"}}
        self.assertEqual(classify_record(rec), "bash_progress")

    def test_hook_progress(self):
        rec = {"type": "progress", "data": {"type": "hook_progress"}}
        self.assertEqual(classify_record(rec), "hook_progress")

    def test_unknown_progress(self):
        rec = {"type": "progress", "data": {"type": "query_update"}}
        self.assertEqual(classify_record(rec), "skip")

    def test_turn_duration(self):
        rec = {"type": "system", "subtype": "turn_duration", "durationMs": 5000}
        self.assertEqual(classify_record(rec), "turn_duration")

    def test_api_error(self):
        rec = {"type": "system", "subtype": "api_error", "cause": {}}
        self.assertEqual(classify_record(rec), "api_error")

    def test_compact_boundary(self):
        rec = {"type": "system", "subtype": "compact_boundary"}
        self.assertEqual(classify_record(rec), "compact_boundary")

    def test_system_other(self):
        rec = {"type": "system", "subtype": "local_command"}
        self.assertEqual(classify_record(rec), "skip")

    def test_summary(self):
        rec = {"type": "summary", "summary": "test"}
        self.assertEqual(classify_record(rec), "summary")

    def test_queue_operation(self):
        rec = {"type": "queue-operation", "operation": "enqueue"}
        self.assertEqual(classify_record(rec), "queue_operation")

    def test_file_history_skip(self):
        rec = {"type": "file-history-snapshot"}
        self.assertEqual(classify_record(rec), "skip")

    def test_saved_hook_context_skip(self):
        rec = {"type": "saved_hook_context"}
        self.assertEqual(classify_record(rec), "skip")


class TestIsMainSession(unittest.TestCase):
    def test_main_session(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "main.jsonl", [
                {"type": "user", "isSidechain": False, "sessionId": "abc123",
                 "message": {"content": "hello"}},
            ])
            self.assertTrue(is_main_session(path))

    def test_subagent_sidechain(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "sub.jsonl", [
                {"type": "user", "isSidechain": True, "agentId": "ab72d42",
                 "sessionId": "abc123", "message": {"content": "task prompt"}},
            ])
            self.assertFalse(is_main_session(path))

    def test_subagent_agentid(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "sub2.jsonl", [
                {"type": "user", "agentId": "ab72d42",
                 "message": {"content": "task prompt"}},
            ])
            self.assertFalse(is_main_session(path))

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "empty.jsonl")
            with open(path, "w") as f:
                pass
            self.assertFalse(is_main_session(path))

    def test_nonexistent_file(self):
        self.assertFalse(is_main_session("/nonexistent/path.jsonl"))

    def test_first_record_no_sidechain_no_agentid(self):
        """A record without isSidechain or agentId is treated as main session."""
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "main2.jsonl", [
                {"type": "user", "message": {"content": "hello"}},
            ])
            self.assertTrue(is_main_session(path))


# =========================================================================
# Task 3 — Metadata tests
# =========================================================================


class TestExtractMetadata(unittest.TestCase):
    def _sample_records(self):
        return [
            {
                "type": "user",
                "sessionId": "sess-001",
                "slug": "happy-coding-cat",
                "cwd": "/home/user/project",
                "gitBranch": "main",
                "version": "2.1.37",
                "timestamp": "2026-02-09T03:18:09.566Z",
                "message": {"role": "user", "content": "hello"},
            },
            {
                "type": "assistant",
                "sessionId": "sess-001",
                "timestamp": "2026-02-09T03:18:12.882Z",
                "message": {
                    "model": "claude-opus-4-6",
                    "id": "msg_01",
                    "content": [{"type": "text", "text": "Hi"}],
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_read_input_tokens": 200,
                        "cache_creation_input_tokens": 300,
                    },
                },
            },
            {
                "type": "assistant",
                "sessionId": "sess-001",
                "timestamp": "2026-02-09T03:18:14.000Z",
                "message": {
                    "model": "claude-opus-4-6",
                    "id": "msg_01",
                    "content": [{"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "ls"}}],
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 5,
                        "cache_read_input_tokens": 20,
                        "cache_creation_input_tokens": 30,
                    },
                },
            },
            {
                "type": "system",
                "subtype": "turn_duration",
                "durationMs": 5000,
                "timestamp": "2026-02-09T03:18:20.000Z",
            },
            {
                "type": "system",
                "subtype": "turn_duration",
                "durationMs": 3000,
                "timestamp": "2026-02-09T03:20:00.000Z",
            },
        ]

    def test_basic_metadata(self):
        records = self._sample_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["session_id"], "sess-001")
        self.assertEqual(meta["slug"], "happy-coding-cat")
        self.assertEqual(meta["cwd"], "/home/user/project")
        self.assertEqual(meta["git_branch"], "main")
        self.assertEqual(meta["model"], "claude-opus-4-6")
        self.assertEqual(meta["version"], "2.1.37")

    def test_timestamps(self):
        records = self._sample_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["first_timestamp"], "2026-02-09T03:18:09.566Z")
        self.assertEqual(meta["last_timestamp"], "2026-02-09T03:20:00.000Z")

    def test_token_totals(self):
        records = self._sample_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["input_tokens"], 110)
        self.assertEqual(meta["output_tokens"], 55)
        self.assertEqual(meta["cache_read_tokens"], 220)
        self.assertEqual(meta["cache_creation_tokens"], 330)

    def test_turn_count_and_durations(self):
        records = self._sample_records()
        meta = extract_metadata(records)
        self.assertEqual(meta["turn_count"], 2)
        self.assertEqual(meta["turn_durations"], [5000, 3000])

    def test_empty_records(self):
        meta = extract_metadata([])
        self.assertIsNone(meta["session_id"])
        self.assertEqual(meta["input_tokens"], 0)
        self.assertEqual(meta["turn_count"], 0)


# =========================================================================
# Task 4 — Conversation flow tests
# =========================================================================


class TestExtractConversation(unittest.TestCase):
    def test_simple_conversation(self):
        records = [
            {"type": "user", "message": {"role": "user", "content": "What is 2+2?"}},
            {
                "type": "assistant",
                "message": {
                    "id": "msg_01",
                    "content": [{"type": "text", "text": "The answer is 4."}],
                    "usage": {},
                },
            },
        ]
        turns = extract_conversation(records)
        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]["type"], "human_message")
        self.assertEqual(turns[0]["text"], "What is 2+2?")
        self.assertEqual(turns[1]["type"], "assistant_turn")
        self.assertEqual(turns[1]["text"], "The answer is 4.")
        self.assertEqual(turns[1]["tool_calls"], [])

    def test_assistant_with_thinking_filtered(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_02",
                    "content": [{"type": "thinking", "thinking": "Let me think..."}],
                    "usage": {},
                },
            },
            {
                "type": "assistant",
                "message": {
                    "id": "msg_02",
                    "content": [{"type": "text", "text": "Here is my answer."}],
                    "usage": {},
                },
            },
        ]
        turns = extract_conversation(records)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]["type"], "assistant_turn")
        self.assertEqual(turns[0]["text"], "Here is my answer.")

    def test_assistant_multi_record_merge(self):
        """Multiple assistant records with same message.id should merge."""
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_03",
                    "content": [{"type": "text", "text": "Part 1"}],
                    "usage": {},
                },
            },
            {
                "type": "assistant",
                "message": {
                    "id": "msg_03",
                    "content": [{"type": "tool_use", "id": "toolu_1", "name": "Bash",
                                 "input": {"command": "ls"}}],
                    "usage": {},
                },
            },
        ]
        turns = extract_conversation(records)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]["text"], "Part 1")
        self.assertEqual(len(turns[0]["tool_calls"]), 1)
        self.assertEqual(turns[0]["tool_calls"][0]["name"], "Bash")

    def test_tool_result(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_04",
                    "content": [{"type": "tool_use", "id": "toolu_abc", "name": "Read",
                                 "input": {"file_path": "/tmp/test.txt"}}],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_abc",
                         "content": "file contents here", "is_error": False}
                    ],
                },
            },
        ]
        turns = extract_conversation(records)
        self.assertEqual(len(turns), 2)
        tr = turns[1]
        self.assertEqual(tr["type"], "tool_result")
        self.assertEqual(tr["tool_name"], "Read")
        self.assertFalse(tr["is_error"])
        self.assertEqual(tr["content_preview"], "file contents here")

    def test_tool_result_error(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_05",
                    "content": [{"type": "tool_use", "id": "toolu_err", "name": "Bash",
                                 "input": {"command": "fail"}}],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_err",
                         "content": "command not found", "is_error": True}
                    ],
                },
            },
        ]
        turns = extract_conversation(records)
        tr = turns[1]
        self.assertTrue(tr["is_error"])

    def test_tool_result_content_as_array(self):
        """Tool result content can be an array of {type: text, text: ...}."""
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_06",
                    "content": [{"type": "tool_use", "id": "toolu_arr", "name": "Task",
                                 "input": {"description": "do thing"}}],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_arr",
                         "content": [
                             {"type": "text", "text": "Result line 1"},
                             {"type": "text", "text": "Result line 2"},
                         ]}
                    ],
                },
            },
        ]
        turns = extract_conversation(records)
        tr = turns[1]
        self.assertIn("Result line 1", tr["content_preview"])
        self.assertIn("Result line 2", tr["content_preview"])

    def test_content_truncation(self):
        """Content preview should be truncated to 500 chars."""
        long_content = "x" * 600
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_07",
                    "content": [{"type": "tool_use", "id": "toolu_long", "name": "Bash",
                                 "input": {"command": "cat big"}}],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_long",
                         "content": long_content}
                    ],
                },
            },
        ]
        turns = extract_conversation(records)
        tr = turns[1]
        self.assertTrue(len(tr["content_preview"]) <= 503)  # 500 + "..."
        self.assertTrue(tr["content_preview"].endswith("..."))

    def test_skips_progress_records(self):
        records = [
            {"type": "user", "message": {"role": "user", "content": "hello"}},
            {"type": "progress", "data": {"type": "bash_progress"}},
            {
                "type": "assistant",
                "message": {"id": "msg_08", "content": [{"type": "text", "text": "hi"}], "usage": {}},
            },
        ]
        turns = extract_conversation(records)
        self.assertEqual(len(turns), 2)
        types = [t["type"] for t in turns]
        self.assertNotIn("progress", types)


# =========================================================================
# Task 5 — Signal extraction tests
# =========================================================================


class TestExtractSkills(unittest.TestCase):
    def test_skill_extraction(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_s1",
                    "content": [
                        {"type": "tool_use", "id": "toolu_skill1", "name": "Skill",
                         "input": {"skill": "superpowers:writing-plans", "args": "plan the feature"}}
                    ],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_skill1",
                         "content": "Plan created successfully."}
                    ],
                },
            },
        ]
        skills = extract_skills(records)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0]["skill_name"], "superpowers:writing-plans")
        self.assertEqual(skills[0]["args"], "plan the feature")
        self.assertEqual(skills[0]["result"], "Plan created successfully.")
        self.assertEqual(skills[0]["tool_use_id"], "toolu_skill1")

    def test_no_skills(self):
        records = [
            {"type": "user", "message": {"content": "hello"}},
        ]
        self.assertEqual(extract_skills(records), [])

    def test_skill_without_result(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_s2",
                    "content": [
                        {"type": "tool_use", "id": "toolu_skill2", "name": "Skill",
                         "input": {"skill": "commit"}}
                    ],
                    "usage": {},
                },
            },
        ]
        skills = extract_skills(records)
        self.assertEqual(len(skills), 1)
        self.assertIsNone(skills[0]["result"])


class TestExtractSubagents(unittest.TestCase):
    def test_subagent_extraction(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_t1",
                    "content": [
                        {"type": "tool_use", "id": "toolu_task1", "name": "Task",
                         "input": {
                             "description": "Explore token mechanism",
                             "prompt": "Investigate the token flow...",
                             "subagent_type": "general-purpose",
                         }}
                    ],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_task1",
                         "content": [
                             {"type": "text", "text": "Found the token mechanism."},
                             {"type": "text",
                              "text": "agentId: ab72d42 (for resuming)\n<usage>total_tokens: 37577\ntool_uses: 4\nduration_ms: 155647</usage>"},
                         ]}
                    ],
                },
                "toolUseResult": {"status": "completed", "prompt": "Investigate..."},
            },
        ]
        subagents = extract_subagents(records)
        self.assertEqual(len(subagents), 1)
        sa = subagents[0]
        self.assertEqual(sa["description"], "Explore token mechanism")
        self.assertEqual(sa["subagent_type"], "general-purpose")
        self.assertEqual(sa["agent_id"], "ab72d42")
        self.assertEqual(sa["status"], "completed")
        self.assertEqual(sa["duration"], 155647)
        self.assertEqual(sa["tokens"], 37577)

    def test_no_subagents(self):
        records = [{"type": "user", "message": {"content": "hello"}}]
        self.assertEqual(extract_subagents(records), [])


class TestExtractToolFailures(unittest.TestCase):
    def test_tool_failure(self):
        records = [
            {
                "type": "assistant",
                "message": {
                    "id": "msg_f1",
                    "content": [
                        {"type": "tool_use", "id": "toolu_fail1", "name": "Read",
                         "input": {"file_path": "/nonexistent"}}
                    ],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_fail1",
                         "content": "<tool_use_error>File does not exist.</tool_use_error>",
                         "is_error": True}
                    ],
                },
            },
        ]
        failures = extract_tool_failures(records)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["tool_name"], "Read")
        self.assertTrue(failures[0]["content_preview"].startswith("<tool_use_error>"))

    def test_no_failures(self):
        records = [
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_ok",
                         "content": "success", "is_error": False}
                    ],
                },
            },
        ]
        self.assertEqual(extract_tool_failures(records), [])


class TestExtractApiErrors(unittest.TestCase):
    def test_api_error(self):
        records = [
            {
                "type": "system",
                "subtype": "api_error",
                "cause": {"code": "ECONNRESET"},
                "retryAttempt": 1,
                "maxRetries": 10,
                "retryInMs": 515.43,
                "timestamp": "2026-02-09T03:30:00.000Z",
            },
        ]
        errors = extract_api_errors(records)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["cause"]["code"], "ECONNRESET")
        self.assertEqual(errors[0]["retry_attempt"], 1)
        self.assertEqual(errors[0]["max_retries"], 10)
        self.assertAlmostEqual(errors[0]["retry_in_ms"], 515.43)

    def test_no_api_errors(self):
        records = [{"type": "system", "subtype": "turn_duration"}]
        self.assertEqual(extract_api_errors(records), [])


class TestExtractCompactions(unittest.TestCase):
    def test_compaction(self):
        records = [
            {
                "type": "system",
                "subtype": "compact_boundary",
                "content": "Conversation compacted",
                "timestamp": "2026-02-09T04:00:00.000Z",
                "compactMetadata": {"trigger": "auto", "preTokens": 168602},
            },
        ]
        compactions = extract_compactions(records)
        self.assertEqual(len(compactions), 1)
        self.assertEqual(compactions[0]["trigger"], "auto")
        self.assertEqual(compactions[0]["pre_tokens"], 168602)
        self.assertEqual(compactions[0]["content"], "Conversation compacted")

    def test_no_compactions(self):
        records = [{"type": "user", "message": {"content": "hello"}}]
        self.assertEqual(extract_compactions(records), [])


# =========================================================================
# Task 6 — Pipeline + CLI tests
# =========================================================================


class TestFindSubagentFiles(unittest.TestCase):
    def test_find_subagents(self):
        with tempfile.TemporaryDirectory() as td:
            session_id = "4842e703-b98d-400e-aa9f-98aaf9489ace"
            session_path = os.path.join(td, f"{session_id}.jsonl")
            subagents_dir = os.path.join(td, session_id, "subagents")
            os.makedirs(subagents_dir)

            # Write session file
            _write_jsonl(td, f"{session_id}.jsonl", [
                {"type": "user", "message": {"content": "hello"}},
            ])
            # Write subagent files
            _write_jsonl(subagents_dir, "agent-ab72d42.jsonl", [
                {"type": "user", "isSidechain": True, "agentId": "ab72d42"},
            ])
            _write_jsonl(subagents_dir, "agent-cd1234f.jsonl", [
                {"type": "user", "isSidechain": True, "agentId": "cd1234f"},
            ])

            files = find_subagent_files(session_path)
            self.assertEqual(len(files), 2)
            names = sorted([f.name for f in files])
            self.assertIn("agent-ab72d42.jsonl", names)
            self.assertIn("agent-cd1234f.jsonl", names)

    def test_no_subagents_dir(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "session.jsonl", [{"type": "user"}])
            files = find_subagent_files(path)
            self.assertEqual(files, [])


class TestExtractSession(unittest.TestCase):
    def test_full_pipeline(self):
        with tempfile.TemporaryDirectory() as td:
            records = [
                {
                    "type": "user",
                    "sessionId": "sess-full",
                    "slug": "test-session",
                    "cwd": "/home/user",
                    "gitBranch": "main",
                    "version": "2.1.37",
                    "timestamp": "2026-02-09T03:18:09.566Z",
                    "isSidechain": False,
                    "message": {"role": "user", "content": "hello world"},
                },
                {
                    "type": "assistant",
                    "sessionId": "sess-full",
                    "timestamp": "2026-02-09T03:18:12.000Z",
                    "message": {
                        "model": "claude-opus-4-6",
                        "id": "msg_full1",
                        "content": [{"type": "text", "text": "Hi there!"}],
                        "usage": {"input_tokens": 100, "output_tokens": 50,
                                  "cache_read_input_tokens": 0,
                                  "cache_creation_input_tokens": 0},
                    },
                },
                {
                    "type": "system",
                    "subtype": "turn_duration",
                    "durationMs": 3000,
                    "timestamp": "2026-02-09T03:18:15.000Z",
                },
            ]
            path = _write_jsonl(td, "sess-full.jsonl", records)
            result = extract_session(path)
            self.assertIsNotNone(result)
            self.assertEqual(result["metadata"]["session_id"], "sess-full")
            self.assertEqual(len(result["conversation"]), 2)
            self.assertEqual(result["conversation"][0]["type"], "human_message")
            self.assertEqual(result["conversation"][1]["type"], "assistant_turn")
            self.assertEqual(result["skills"], [])
            self.assertEqual(result["subagents"], [])
            self.assertEqual(result["tool_failures"], [])
            self.assertEqual(result["api_errors"], [])
            self.assertEqual(result["compactions"], [])
            self.assertEqual(result["subagent_files"], [])

    def test_rejects_subagent(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "sub.jsonl", [
                {"type": "user", "isSidechain": True, "agentId": "ab72d42",
                 "message": {"content": "task"}},
            ])
            result = extract_session(path)
            self.assertIsNone(result)

    def test_cli_output_file(self):
        """Test that CLI writes valid JSON to --output file."""
        with tempfile.TemporaryDirectory() as td:
            session_records = [
                {
                    "type": "user",
                    "sessionId": "sess-cli",
                    "isSidechain": False,
                    "timestamp": "2026-02-09T03:18:09.566Z",
                    "message": {"role": "user", "content": "test"},
                },
            ]
            session_path = _write_jsonl(td, "session.jsonl", session_records)
            output_path = os.path.join(td, "output.json")

            # Run CLI via subprocess-like invocation
            import subprocess
            script_path = os.path.join(os.path.dirname(__file__), "extract_session.py")
            result = subprocess.run(
                [sys.executable, script_path, session_path, "--output", output_path],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, f"stderr: {result.stderr}")
            self.assertTrue(os.path.exists(output_path))

            with open(output_path) as f:
                data = json.load(f)
            self.assertIn("metadata", data)
            self.assertIn("conversation", data)

    def test_cli_rejects_subagent(self):
        """CLI should exit with error for subagent files."""
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            path = _write_jsonl(td, "sub.jsonl", [
                {"type": "user", "isSidechain": True, "agentId": "x",
                 "message": {"content": "task"}},
            ])
            script_path = os.path.join(os.path.dirname(__file__), "extract_session.py")
            result = subprocess.run(
                [sys.executable, script_path, path],
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
