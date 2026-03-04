#!/usr/bin/env python3
"""Tests for search_sessions.py — OpenClaw session search."""

import json
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from search_sessions import (
    count_turns,
    search_sessions,
    MAX_SESSIONS,
    DEFAULT_LATEST,
    DEFAULT_MIN_TURNS,
)


def _write_openclaw_session(path, num_user_msgs=4):
    """Write a minimal valid OpenClaw session JSONL with num_user_msgs user turns.

    Also includes a toolResult message (should NOT count as a user turn)
    and an assistant message.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        # Session header
        f.write(json.dumps({
            "type": "session",
            "version": 3,
            "id": "fake-session-id",
            "timestamp": "2026-03-03T12:00:00.000Z",
            "cwd": "/tmp",
        }) + "\n")
        for i in range(num_user_msgs):
            # User message
            f.write(json.dumps({
                "type": "message",
                "id": f"user-{i}",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": f"User message {i}"}],
                },
            }) + "\n")
            # Assistant reply
            f.write(json.dumps({
                "type": "message",
                "id": f"asst-{i}",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": f"Reply {i}"}],
                    "model": "test-model",
                    "provider": "test-provider",
                    "usage": {"input": 10, "output": 20, "cost": {"total": 0.01}},
                },
            }) + "\n")
        # A toolResult message (should NOT count as a user turn)
        f.write(json.dumps({
            "type": "message",
            "id": "tool-result-1",
            "message": {
                "role": "toolResult",
                "toolCallId": "tc-1",
                "toolName": "read",
                "content": [{"type": "text", "text": "file contents"}],
                "isError": False,
            },
        }) + "\n")


class TestConstants(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(MAX_SESSIONS, 20)
        self.assertEqual(DEFAULT_LATEST, 5)
        self.assertEqual(DEFAULT_MIN_TURNS, 3)


class TestCountTurns(unittest.TestCase):
    def test_counts_user_messages_only(self):
        """count_turns should count user messages and skip toolResult."""
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "session.jsonl")
            _write_openclaw_session(path, num_user_msgs=4)
            count = count_turns(path)
            self.assertEqual(count, 4)

    def test_zero_user_messages(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "session.jsonl")
            _write_openclaw_session(path, num_user_msgs=0)
            count = count_turns(path)
            self.assertEqual(count, 0)

    def test_skips_tool_result(self):
        """Explicitly verify toolResult is not counted."""
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "session.jsonl")
            with open(path, "w") as f:
                f.write(json.dumps({
                    "type": "session", "version": 3, "id": "x",
                    "timestamp": "2026-03-03T12:00:00Z", "cwd": "/tmp",
                }) + "\n")
                # One toolResult only
                f.write(json.dumps({
                    "type": "message", "id": "tr1",
                    "message": {"role": "toolResult", "toolName": "read",
                                "content": [{"type": "text", "text": "data"}]},
                }) + "\n")
            count = count_turns(path)
            self.assertEqual(count, 0)


class TestSearchSessions(unittest.TestCase):
    def _setup_agents(self, td):
        """Create a fake ~/.openclaw/agents/ structure inside td (used as HOME)."""
        agents_dir = os.path.join(td, ".openclaw", "agents")

        # Agent "main" with 3 active sessions
        main_sessions = os.path.join(agents_dir, "main", "sessions")
        os.makedirs(main_sessions)
        # sessions.json (should be skipped)
        with open(os.path.join(main_sessions, "sessions.json"), "w") as f:
            json.dump([], f)

        for i, uuid in enumerate([
            "aaaa-1111-0000-0000-000000000001",
            "aaaa-1111-0000-0000-000000000002",
            "aaaa-1111-0000-0000-000000000003",
        ]):
            p = os.path.join(main_sessions, f"{uuid}.jsonl")
            _write_openclaw_session(p, num_user_msgs=4)
            # Stagger mtime so ordering is deterministic
            mtime = time.time() - (10 * (2 - i))
            os.utime(p, (mtime, mtime))

        # A reset session
        reset_path = os.path.join(
            main_sessions,
            "aaaa-1111-0000-0000-000000000004.jsonl.reset.1709000000000",
        )
        _write_openclaw_session(reset_path, num_user_msgs=5)

        # A deleted session
        deleted_path = os.path.join(
            main_sessions,
            "aaaa-1111-0000-0000-000000000005.jsonl.deleted.1709000000000",
        )
        _write_openclaw_session(deleted_path, num_user_msgs=5)

        # Agent "tool-runner" with 1 session
        tr_sessions = os.path.join(agents_dir, "tool-runner", "sessions")
        os.makedirs(tr_sessions)
        p = os.path.join(tr_sessions, "bbbb-2222-0000-0000-000000000001.jsonl")
        _write_openclaw_session(p, num_user_msgs=6)

        return agents_dir

    def test_search_by_agent(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=10, min_turns=1)
                self.assertEqual(len(results), 3)
                # All should be from agent "main"
                for r in results:
                    self.assertEqual(r["agent_id"], "main")

    def test_excludes_reset_and_deleted_by_default(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=10, min_turns=1)
                for r in results:
                    self.assertNotIn(".reset.", r["path"])
                    self.assertNotIn(".deleted.", r["path"])

    def test_include_reset_flag(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(
                    agent="main", latest=10, min_turns=1, include_reset=True,
                )
                paths = [r["path"] for r in results]
                has_reset = any(".reset." in p for p in paths)
                has_deleted = any(".deleted." in p for p in paths)
                self.assertTrue(has_reset, "Should include .reset. files")
                self.assertTrue(has_deleted, "Should include .deleted. files")

    def test_search_all_agents(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent=None, latest=10, min_turns=1)
                agent_ids = {r["agent_id"] for r in results}
                self.assertIn("main", agent_ids)
                self.assertIn("tool-runner", agent_ids)

    def test_min_turns_filter(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            # Add a low-turn session
            low_turn_path = os.path.join(
                td, ".openclaw", "agents", "main", "sessions",
                "cccc-3333-0000-0000-000000000001.jsonl",
            )
            _write_openclaw_session(low_turn_path, num_user_msgs=1)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=10, min_turns=3)
                for r in results:
                    self.assertGreaterEqual(r["turn_count"], 3)

    def test_hard_cap(self):
        """latest is capped at MAX_SESSIONS."""
        with tempfile.TemporaryDirectory() as td:
            agents_dir = os.path.join(td, ".openclaw", "agents", "big", "sessions")
            os.makedirs(agents_dir)
            for i in range(30):
                uuid = f"dddd-{i:04d}-0000-0000-000000000000"
                p = os.path.join(agents_dir, f"{uuid}.jsonl")
                _write_openclaw_session(p, num_user_msgs=5)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="big", latest=100, min_turns=1)
                self.assertLessEqual(len(results), MAX_SESSIONS)

    def test_sorted_by_mtime_descending(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=10, min_turns=1)
                mtimes = [r["modified"] for r in results]
                self.assertEqual(mtimes, sorted(mtimes, reverse=True))

    def test_result_fields(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=1, min_turns=1)
                self.assertEqual(len(results), 1)
                r = results[0]
                self.assertIn("path", r)
                self.assertIn("session_id", r)
                self.assertIn("agent_id", r)
                self.assertIn("modified", r)
                self.assertIn("size_bytes", r)
                self.assertIn("turn_count", r)

    def test_session_id_is_uuid_part(self):
        with tempfile.TemporaryDirectory() as td:
            self._setup_agents(td)
            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", latest=10, min_turns=1)
                for r in results:
                    # session_id should be uuid, not include .jsonl
                    self.assertFalse(r["session_id"].endswith(".jsonl"))
                    self.assertNotIn("/", r["session_id"])

    def test_date_filter(self):
        """--date filters to sessions modified on that date."""
        with tempfile.TemporaryDirectory() as td:
            agents_dir = os.path.join(td, ".openclaw", "agents", "main", "sessions")
            os.makedirs(agents_dir)
            # Create a session and set its mtime to a known date
            p = os.path.join(agents_dir, "eeee-0001-0000-0000-000000000000.jsonl")
            _write_openclaw_session(p, num_user_msgs=4)
            # Set mtime to 2026-03-02 12:00:00 UTC
            import datetime
            dt = datetime.datetime(2026, 3, 2, 12, 0, 0)
            ts = dt.timestamp()
            os.utime(p, (ts, ts))

            with patch.dict(os.environ, {"HOME": td}):
                # Search for that exact date
                results = search_sessions(agent="main", date="2026-03-02",
                                          latest=10, min_turns=1)
                self.assertEqual(len(results), 1)
                # Search for a different date
                results = search_sessions(agent="main", date="2026-03-01",
                                          latest=10, min_turns=1)
                self.assertEqual(len(results), 0)

    def test_since_filter(self):
        """--since filters to sessions modified on or after that date."""
        with tempfile.TemporaryDirectory() as td:
            agents_dir = os.path.join(td, ".openclaw", "agents", "main", "sessions")
            os.makedirs(agents_dir)
            import datetime

            # Old session: 2026-02-28
            p1 = os.path.join(agents_dir, "ffff-0001-0000-0000-000000000000.jsonl")
            _write_openclaw_session(p1, num_user_msgs=4)
            dt1 = datetime.datetime(2026, 2, 28, 12, 0, 0)
            os.utime(p1, (dt1.timestamp(), dt1.timestamp()))

            # New session: 2026-03-02
            p2 = os.path.join(agents_dir, "ffff-0002-0000-0000-000000000000.jsonl")
            _write_openclaw_session(p2, num_user_msgs=4)
            dt2 = datetime.datetime(2026, 3, 2, 12, 0, 0)
            os.utime(p2, (dt2.timestamp(), dt2.timestamp()))

            with patch.dict(os.environ, {"HOME": td}):
                results = search_sessions(agent="main", since="2026-03-01",
                                          latest=10, min_turns=1)
                self.assertEqual(len(results), 1)
                self.assertIn("ffff-0002", results[0]["session_id"])


if __name__ == "__main__":
    unittest.main()
