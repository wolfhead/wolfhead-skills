import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readGroups, writeGroups, type GroupEntry } from "../src/storage.js";

describe("group storage", () => {
  let tmpDir: string;
  let groupsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-groups-test-"));
    groupsPath = path.join(tmpDir, "groups.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readGroups returns empty array for missing file", () => {
    expect(readGroups(groupsPath)).toEqual([]);
  });

  it("writeGroups creates file and readGroups reads it back", () => {
    const groups: GroupEntry[] = [
      {
        label: "ask_before_implementing",
        merged_summary: "Present approach to user before writing code",
        insight_ids: ["INS-001", "INS-002"],
        count: 2,
      },
    ];

    writeGroups(groupsPath, groups);
    const result = readGroups(groupsPath);

    expect(result).toEqual(groups);
  });

  it("writeGroups overwrites existing file", () => {
    const v1: GroupEntry[] = [
      { label: "old", merged_summary: "old summary", insight_ids: ["INS-1"], count: 1 },
    ];
    const v2: GroupEntry[] = [
      { label: "new", merged_summary: "new summary", insight_ids: ["INS-2"], count: 1 },
    ];

    writeGroups(groupsPath, v1);
    writeGroups(groupsPath, v2);
    const result = readGroups(groupsPath);

    expect(result).toEqual(v2);
  });
});
