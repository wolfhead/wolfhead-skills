/**
 * Retrieve command: reads promoted learnings from MEMORY.md files.
 *
 * Supports reading project-specific and global MEMORY.md files,
 * with text or JSON output formats.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { pathToProjectKey } from "../sessions/search.js";

export interface RetrieveOptions {
  projectPath?: string;
  global: boolean;
  format: "text" | "json";
}

/**
 * Convert a project path to its corresponding MEMORY.md path.
 *
 * /Users/me/work/project -> ~/.claude/projects/-Users-me-work-project/memory/MEMORY.md
 */
export function projectPathToMemoryPath(
  projectPath: string,
  homeDir?: string
): string {
  const home = homeDir ?? os.homedir();
  const key = pathToProjectKey(projectPath);
  return path.join(home, ".claude", "projects", key, "memory", "MEMORY.md");
}

/**
 * Return the path to the global MEMORY.md file.
 */
export function globalMemoryPath(homeDir?: string): string {
  const home = homeDir ?? os.homedir();
  return path.join(home, ".claude", "MEMORY.md");
}

/**
 * Read a file and return its contents, or empty string if it doesn't exist.
 */
function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Retrieve promoted learnings from MEMORY.md files.
 *
 * Returns the content as a string (text format) or JSON string.
 */
export function executeRetrieve(
  options: RetrieveOptions,
  homeDir?: string
): string {
  const parts: string[] = [];

  if (options.projectPath) {
    const memPath = projectPathToMemoryPath(options.projectPath, homeDir);
    const content = readFileOrEmpty(memPath);
    if (content) {
      parts.push(content);
    }
  }

  if (options.global) {
    const memPath = globalMemoryPath(homeDir);
    const content = readFileOrEmpty(memPath);
    if (content) {
      parts.push(content);
    }
  }

  const combined = parts.join("\n---\n");

  if (options.format === "json") {
    return JSON.stringify({
      project: options.projectPath ?? null,
      global: options.global,
      content: combined,
    });
  }

  return combined;
}
