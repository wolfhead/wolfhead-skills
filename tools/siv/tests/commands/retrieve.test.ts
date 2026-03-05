import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  projectPathToMemoryPath,
  globalMemoryPath,
  executeRetrieve,
} from "../../src/commands/retrieve.js";

describe("projectPathToMemoryPath", () => {
  it("converts project path to memory path", () => {
    const result = projectPathToMemoryPath("/Users/me/work/project", "/home/test");
    expect(result).toBe(
      "/home/test/.claude/projects/-Users-me-work-project/memory/MEMORY.md"
    );
  });

  it("handles underscores in project path", () => {
    const result = projectPathToMemoryPath("/Users/me/my_project", "/home/test");
    expect(result).toBe(
      "/home/test/.claude/projects/-Users-me-my-project/memory/MEMORY.md"
    );
  });

  it("strips trailing slashes", () => {
    const result = projectPathToMemoryPath("/Users/me/project/", "/home/test");
    expect(result).toBe(
      "/home/test/.claude/projects/-Users-me-project/memory/MEMORY.md"
    );
  });
});

describe("globalMemoryPath", () => {
  it("returns global MEMORY.md path", () => {
    const result = globalMemoryPath("/home/test");
    expect(result).toBe("/home/test/.claude/MEMORY.md");
  });

  it("uses os.homedir when no homeDir given", () => {
    const result = globalMemoryPath();
    expect(result).toBe(path.join(os.homedir(), ".claude", "MEMORY.md"));
  });
});

describe("executeRetrieve", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-retrieve-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads project MEMORY.md", () => {
    const memDir = path.join(
      tmpDir,
      ".claude",
      "projects",
      "-Users-me-work-project",
      "memory"
    );
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "MEMORY.md"), "# Project Learnings\n- Use Edit over sed\n");

    const result = executeRetrieve(
      {
        projectPath: "/Users/me/work/project",
        global: false,
        format: "text",
      },
      tmpDir
    );

    expect(result).toBe("# Project Learnings\n- Use Edit over sed\n");
  });

  it("reads global MEMORY.md", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "MEMORY.md"),
      "# Global Learnings\n- Always read before write\n"
    );

    const result = executeRetrieve(
      {
        global: true,
        format: "text",
      },
      tmpDir
    );

    expect(result).toBe("# Global Learnings\n- Always read before write\n");
  });

  it("concatenates project and global with separator", () => {
    // Create project memory
    const memDir = path.join(
      tmpDir,
      ".claude",
      "projects",
      "-Users-me-work-project",
      "memory"
    );
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "MEMORY.md"), "project content");

    // Create global memory
    const claudeDir = path.join(tmpDir, ".claude");
    fs.writeFileSync(path.join(claudeDir, "MEMORY.md"), "global content");

    const result = executeRetrieve(
      {
        projectPath: "/Users/me/work/project",
        global: true,
        format: "text",
      },
      tmpDir
    );

    expect(result).toBe("project content\n---\nglobal content");
  });

  it("returns empty string for missing project MEMORY.md", () => {
    const result = executeRetrieve(
      {
        projectPath: "/Users/me/nonexistent",
        global: false,
        format: "text",
      },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns empty string for missing global MEMORY.md", () => {
    const result = executeRetrieve(
      {
        global: true,
        format: "text",
      },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns empty string when both files missing", () => {
    const result = executeRetrieve(
      {
        projectPath: "/Users/me/nonexistent",
        global: true,
        format: "text",
      },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns JSON format when requested", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "MEMORY.md"), "global stuff");

    const result = executeRetrieve(
      {
        projectPath: "/Users/me/project",
        global: true,
        format: "json",
      },
      tmpDir
    );

    const parsed = JSON.parse(result);
    expect(parsed.project).toBe("/Users/me/project");
    expect(parsed.global).toBe(true);
    expect(parsed.content).toBe("global stuff");
  });

  it("returns JSON with null project when no projectPath", () => {
    const result = executeRetrieve(
      {
        global: true,
        format: "json",
      },
      tmpDir
    );

    const parsed = JSON.parse(result);
    expect(parsed.project).toBeNull();
    expect(parsed.content).toBe("");
  });

  it("only reads project when global is false", () => {
    // Create both files
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "MEMORY.md"), "global");

    const memDir = path.join(
      claudeDir,
      "projects",
      "-Users-me-proj",
      "memory"
    );
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "MEMORY.md"), "project");

    const result = executeRetrieve(
      {
        projectPath: "/Users/me/proj",
        global: false,
        format: "text",
      },
      tmpDir
    );

    // Should only have project content, not global
    expect(result).toBe("project");
    expect(result).not.toContain("global");
  });
});
