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

    def test_underscores_replaced(self):
        self.assertEqual(
            path_to_project_key("/Users/me/work/my_project"),
            "-Users-me-work-my-project"
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
