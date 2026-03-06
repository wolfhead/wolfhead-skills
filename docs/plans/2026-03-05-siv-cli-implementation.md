# siv CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript CLI tool (`siv`) that unifies session analysis, learning capture, and memory promotion into one tool with structured JSONL storage and LLM-powered analysis/promotion.

**Architecture:** Node/TS CLI with commands (`log`, `analyze`, `run_promotion`, `promote_finding`, `retrieve`, `status`). Storage is append-only JSONL in `~/.siv/`. LLM calls use Claude Agent SDK with deepseek-chat endpoint. All LLM calls are single completions returning structured JSON — no agent tool loops.

**Tech Stack:** TypeScript, Node.js, Commander.js (CLI), dotenv (.env), Claude Agent SDK (@anthropic-ai/claude-code), vitest (testing)

**Reference files:**
- Design doc: `docs/plans/2026-03-05-siv-cli-design.md`
- Python session search to port: `skills/claude-session-analyst/scripts/search_sessions.py`
- Python session extraction to port: `skills/claude-session-analyst/scripts/extract_session.py`
- Analysis instructions source: `skills/session-subagent-analyst/SKILL.md`

---

## Phase 1: Project Scaffolding

### Task 1: Initialize Node/TS project

**Files:**
- Create: `tools/siv/package.json`
- Create: `tools/siv/tsconfig.json`
- Create: `tools/siv/.gitignore`

**Step 1: Create directory structure**

```bash
mkdir -p tools/siv/src tools/siv/tests
```

**Step 2: Create package.json**

```json
{
  "name": "siv",
  "version": "0.1.0",
  "description": "Self-improvement CLI for AI coding agents",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "siv": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.0.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
```

**Step 5: Install dependencies**

```bash
cd tools/siv && npm install
```

**Step 6: Create minimal CLI entry point**

Create `tools/siv/src/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("siv")
  .description("Self-improvement CLI for AI coding agents")
  .version("0.1.0");

program.parse();
```

**Step 7: Verify build works**

```bash
cd tools/siv && npx tsc && node dist/index.js --help
```

Expected: Shows help text with version 0.1.0.

**Step 8: Commit**

```bash
git add tools/siv/
git commit -m "feat(siv): scaffold TypeScript CLI project"
```

---

### Task 2: Config and .env loader

**Files:**
- Create: `tools/siv/src/config.ts`
- Create: `tools/siv/tests/config.test.ts`

**Step 1: Write the failing test**

```typescript
// tools/siv/tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, SIV_DIR } from "../src/config.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("loadConfig", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-config-" + Date.now());
  const origHome = process.env.HOME;

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Point SIV_DIR to test dir by setting HOME
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns defaults when no .env exists", () => {
    const config = loadConfig(testDir);
    expect(config.model).toBe("deepseek-chat");
    expect(config.sivDir).toBe(path.join(testDir, ".siv"));
  });

  it("reads API key from .env", () => {
    const sivDir = path.join(testDir, ".siv");
    fs.mkdirSync(sivDir, { recursive: true });
    fs.writeFileSync(path.join(sivDir, ".env"), "SIV_API_KEY=test-key-123\n");
    const config = loadConfig(testDir);
    expect(config.apiKey).toBe("test-key-123");
  });

  it("reads model and endpoint from .env", () => {
    const sivDir = path.join(testDir, ".siv");
    fs.mkdirSync(sivDir, { recursive: true });
    fs.writeFileSync(
      path.join(sivDir, ".env"),
      "SIV_MODEL=gpt-4\nSIV_API_BASE=https://custom.api/v1\n"
    );
    const config = loadConfig(testDir);
    expect(config.model).toBe("gpt-4");
    expect(config.apiBase).toBe("https://custom.api/v1");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd tools/siv && npx vitest run tests/config.test.ts
```

Expected: FAIL — `loadConfig` not found.

**Step 3: Write implementation**

```typescript
// tools/siv/src/config.ts
import fs from "fs";
import path from "path";
import { config as dotenvConfig } from "dotenv";

export interface SivConfig {
  sivDir: string;
  apiKey: string;
  apiBase: string;
  model: string;
  findingsPath: string;
  promotionsPath: string;
  backupsDir: string;
  promotionThreshold: {
    minSessions: number;
    minOccurrences: number;
    crossProjectMinProjects: number;
  };
}

export function getSivDir(homeDir?: string): string {
  const home = homeDir || process.env.HOME || require("os").homedir();
  return path.join(home, ".siv");
}

export function loadConfig(homeDir?: string): SivConfig {
  const sivDir = getSivDir(homeDir);
  const envPath = path.join(sivDir, ".env");

  if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath, override: true });
  }

  return {
    sivDir,
    apiKey: process.env.SIV_API_KEY || "",
    apiBase: process.env.SIV_API_BASE || "https://api.deepseek.com/v1",
    model: process.env.SIV_MODEL || "deepseek-chat",
    findingsPath: path.join(sivDir, "findings.jsonl"),
    promotionsPath: path.join(sivDir, "promotions.jsonl"),
    backupsDir: path.join(sivDir, "backups"),
    promotionThreshold: {
      minSessions: 2,
      minOccurrences: 3,
      crossProjectMinProjects: 2,
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd tools/siv && npx vitest run tests/config.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tools/siv/src/config.ts tools/siv/tests/config.test.ts
git commit -m "feat(siv): add config and .env loader"
```

---

### Task 3: Storage layer — JSONL append/read and ID generation

**Files:**
- Create: `tools/siv/src/storage.ts`
- Create: `tools/siv/tests/storage.test.ts`

**Step 1: Write failing tests**

```typescript
// tools/siv/tests/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendJsonl, readJsonl, generateId } from "../src/storage.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("generateId", () => {
  it("generates LRN id for non-error categories", () => {
    const id = generateId("correction");
    expect(id).toMatch(/^LRN-\d{8}-[a-f0-9]{3}$/);
  });

  it("generates ERR id for error category", () => {
    const id = generateId("error");
    expect(id).toMatch(/^ERR-\d{8}-[a-f0-9]{3}$/);
  });
});

describe("appendJsonl / readJsonl", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-storage-" + Date.now());
  const testFile = path.join(testDir, "test.jsonl");

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("creates file and appends a line", () => {
    appendJsonl(testFile, { id: "LRN-20260305-a3f", summary: "test" });
    const lines = readJsonl(testFile);
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe("LRN-20260305-a3f");
  });

  it("appends multiple lines", () => {
    appendJsonl(testFile, { id: "1" });
    appendJsonl(testFile, { id: "2" });
    const lines = readJsonl(testFile);
    expect(lines).toHaveLength(2);
  });

  it("returns empty array for missing file", () => {
    const lines = readJsonl(path.join(testDir, "nonexistent.jsonl"));
    expect(lines).toEqual([]);
  });
});

describe("updateFindingStatus", () => {
  // Test that we can mark findings as promoted
  const testDir = path.join(os.tmpdir(), "siv-test-update-" + Date.now());
  const testFile = path.join(testDir, "findings.jsonl");

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("updates status of matching findings", async () => {
    const { updateFindingStatus } = await import("../src/storage.js");
    appendJsonl(testFile, { id: "LRN-001", status: "pending", summary: "a" });
    appendJsonl(testFile, { id: "LRN-002", status: "pending", summary: "b" });
    appendJsonl(testFile, { id: "LRN-003", status: "pending", summary: "c" });

    updateFindingStatus(testFile, ["LRN-001", "LRN-003"], "promoted");

    const lines = readJsonl(testFile);
    expect(lines[0].status).toBe("promoted");
    expect(lines[1].status).toBe("pending");
    expect(lines[2].status).toBe("promoted");
  });
});
```

**Step 2: Run test to verify failure**

```bash
cd tools/siv && npx vitest run tests/storage.test.ts
```

**Step 3: Write implementation**

```typescript
// tools/siv/src/storage.ts
import fs from "fs";
import path from "path";

export function generateId(category: string): string {
  const prefix = category === "error" ? "ERR" : "LRN";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hex = Math.random().toString(16).slice(2, 5);
  return `${prefix}-${date}-${hex}`;
}

export function appendJsonl(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, JSON.stringify(data) + "\n", "utf-8");
}

export function readJsonl<T = Record<string, unknown>>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((item): item is T => item !== null);
}

export function updateFindingStatus(
  filePath: string,
  findingIds: string[],
  newStatus: string
): void {
  const lines = readJsonl<Record<string, unknown>>(filePath);
  const idSet = new Set(findingIds);
  const updated = lines.map((line) =>
    idSet.has(line.id as string) ? { ...line, status: newStatus } : line
  );
  fs.writeFileSync(
    filePath,
    updated.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf-8"
  );
}
```

**Step 4: Run tests**

```bash
cd tools/siv && npx vitest run tests/storage.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tools/siv/src/storage.ts tools/siv/tests/storage.test.ts
git commit -m "feat(siv): add JSONL storage layer with ID generation"
```

---

## Phase 2: `siv log` Command

### Task 4: Implement `siv log`

**Files:**
- Create: `tools/siv/src/commands/log.ts`
- Create: `tools/siv/tests/commands/log.test.ts`
- Modify: `tools/siv/src/index.ts`
- Create: `tools/siv/src/types.ts`

**Step 1: Define types**

```typescript
// tools/siv/src/types.ts
export type FindingCategory =
  | "correction"
  | "error"
  | "knowledge_gap"
  | "best_practice"
  | "feature_request";

export type Priority = "low" | "medium" | "high" | "critical";
export type FindingStatus = "pending" | "promoted" | "dismissed";
export type FindingSource = "analyze" | "manual" | "hook";

export interface Finding {
  id: string;
  ts: string;
  category: FindingCategory;
  summary: string;
  details: string;
  priority: Priority;
  project: string;
  project_path: string;
  session: string;
  tags: string[];
  related_files: string[];
  source: FindingSource;
  status: FindingStatus;
}

export interface Promotion {
  ts: string;
  finding_ids: string[];
  scope: "project" | "global";
  project: string;
  project_path: string;
  category: string;
  rule: string;
  action_taken: string;
  target_file: string;
}
```

**Step 2: Write failing test**

```typescript
// tools/siv/tests/commands/log.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeLog } from "../../src/commands/log.js";
import { readJsonl } from "../../src/storage.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("executeLog", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-log-" + Date.now());

  beforeEach(() => {
    fs.mkdirSync(path.join(testDir, ".siv"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("appends a finding to findings.jsonl", () => {
    const result = executeLog(
      {
        category: "correction",
        summary: "API returns 404 not 400",
        details: "Full details here",
        priority: "medium",
        project: "myproject",
        projectPath: "/path/to/myproject",
        session: "abc123",
        source: "manual",
        tags: "api,http",
        related: "",
      },
      testDir
    );

    expect(result.status).toBe("logged");
    expect(result.id).toMatch(/^LRN-/);

    const findings = readJsonl(path.join(testDir, ".siv", "findings.jsonl"));
    expect(findings).toHaveLength(1);
    expect((findings[0] as any).summary).toBe("API returns 404 not 400");
    expect((findings[0] as any).tags).toEqual(["api", "http"]);
  });

  it("generates ERR prefix for error category", () => {
    const result = executeLog(
      {
        category: "error",
        summary: "pnpm install fails",
        details: "",
        priority: "high",
        project: "myproject",
        projectPath: "/path/to/myproject",
        session: "abc123",
        source: "manual",
        tags: "",
        related: "",
      },
      testDir
    );

    expect(result.id).toMatch(/^ERR-/);
  });
});
```

**Step 3: Run test to verify failure**

```bash
cd tools/siv && npx vitest run tests/commands/log.test.ts
```

**Step 4: Write implementation**

```typescript
// tools/siv/src/commands/log.ts
import { generateId, appendJsonl } from "../storage.js";
import { getSivDir } from "../config.js";
import type { Finding, FindingCategory, Priority, FindingSource } from "../types.js";

export interface LogOptions {
  category: string;
  summary: string;
  details: string;
  priority: string;
  project: string;
  projectPath: string;
  session: string;
  source: string;
  tags: string;
  related: string;
}

export interface LogResult {
  id: string;
  status: "logged";
}

export function executeLog(options: LogOptions, homeDir?: string): LogResult {
  const sivDir = getSivDir(homeDir);
  const findingsPath = `${sivDir}/findings.jsonl`;

  const id = generateId(options.category);
  const finding: Finding = {
    id,
    ts: new Date().toISOString(),
    category: options.category as FindingCategory,
    summary: options.summary,
    details: options.details || "",
    priority: (options.priority || "medium") as Priority,
    project: options.project || "",
    project_path: options.projectPath || "",
    session: options.session || "",
    tags: options.tags ? options.tags.split(",").map((t) => t.trim()) : [],
    related_files: options.related
      ? options.related.split(",").map((f) => f.trim())
      : [],
    source: (options.source || "manual") as FindingSource,
    status: "pending",
  };

  appendJsonl(findingsPath, finding as unknown as Record<string, unknown>);

  return { id, status: "logged" };
}
```

**Step 5: Wire into CLI**

Update `tools/siv/src/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { executeLog } from "./commands/log.js";

const program = new Command();

program
  .name("siv")
  .description("Self-improvement CLI for AI coding agents")
  .version("0.1.0");

program
  .command("log")
  .description("Log a finding")
  .requiredOption("-c, --category <category>", "correction|error|knowledge_gap|best_practice|feature_request")
  .requiredOption("-s, --summary <summary>", "One-line description")
  .option("-d, --details <details>", "Full context")
  .option("-p, --priority <priority>", "low|medium|high|critical", "medium")
  .option("--project <project>", "Project name")
  .option("--project-path <path>", "Project absolute path")
  .option("--session <id>", "Session ID")
  .option("--source <source>", "analyze|manual|hook", "manual")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--related <files>", "Comma-separated file paths")
  .action((options) => {
    const result = executeLog({
      category: options.category,
      summary: options.summary,
      details: options.details || "",
      priority: options.priority,
      project: options.project || "",
      projectPath: options.projectPath || "",
      session: options.session || "",
      source: options.source,
      tags: options.tags || "",
      related: options.related || "",
    });
    console.log(JSON.stringify(result));
  });

program.parse();
```

**Step 6: Run tests and verify CLI**

```bash
cd tools/siv && npx vitest run tests/commands/log.test.ts
cd tools/siv && npx tsx src/index.ts log -c correction -s "test finding" --project test
```

Expected: Tests PASS. CLI prints `{"id":"LRN-...","status":"logged"}`

**Step 7: Commit**

```bash
git add tools/siv/src/ tools/siv/tests/
git commit -m "feat(siv): implement 'siv log' command"
```

---

## Phase 3: Session Search (port from Python)

### Task 5: Port `search_sessions.py` to TypeScript

**Files:**
- Create: `tools/siv/src/sessions/search.ts`
- Create: `tools/siv/tests/sessions/search.test.ts`

**Reference:** `skills/claude-session-analyst/scripts/search_sessions.py` (172 lines)

**Step 1: Write failing tests**

Port the test patterns from `skills/claude-session-analyst/scripts/test_search.py`. Key tests:

```typescript
// tools/siv/tests/sessions/search.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pathToProjectKey, countTurns, searchSessions } from "../../src/sessions/search.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("pathToProjectKey", () => {
  it("converts path to claude project key format", () => {
    expect(pathToProjectKey("/Users/me/work/my_project"))
      .toBe("-Users-me-work-my-project");
  });

  it("strips trailing slash", () => {
    expect(pathToProjectKey("/Users/me/work/"))
      .toBe("-Users-me-work");
  });
});

describe("countTurns", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-turns-" + Date.now());

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("counts human message turns", () => {
    const file = path.join(testDir, "session.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
      JSON.stringify({ type: "user", message: { content: "do this" } }),
    ];
    fs.writeFileSync(file, lines.join("\n") + "\n");
    expect(countTurns(file)).toBe(2);
  });

  it("skips tool_result records", () => {
    const file = path.join(testDir, "session.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
      }),
    ];
    fs.writeFileSync(file, lines.join("\n") + "\n");
    expect(countTurns(file)).toBe(1);
  });

  it("returns 0 for missing file", () => {
    expect(countTurns(path.join(testDir, "nope.jsonl"))).toBe(0);
  });
});

describe("searchSessions", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-search-" + Date.now());
  const projectKey = "-Users-me-work-myproject";
  const projectDir = path.join(testDir, ".claude", "projects", projectKey);

  beforeEach(() => {
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("finds session files in project directory", () => {
    // Create a session file with enough turns
    const sessionFile = path.join(projectDir, "abc-123.jsonl");
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ type: "user", message: { content: `msg ${i}` } })
    );
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");

    const results = searchSessions({
      projectPath: "/Users/me/work/myproject",
      latest: 5,
      minTurns: 3,
      homeDir: testDir,
    });

    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("abc-123");
    expect(results[0].turn_count).toBe(5);
  });

  it("respects minTurns filter", () => {
    const sessionFile = path.join(projectDir, "short.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");

    const results = searchSessions({
      projectPath: "/Users/me/work/myproject",
      latest: 5,
      minTurns: 3,
      homeDir: testDir,
    });

    expect(results).toHaveLength(0);
  });

  it("skips subagent directories", () => {
    const subDir = path.join(projectDir, "session-id", "subagents");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, "agent-1.jsonl"),
      Array.from({ length: 5 }, () =>
        JSON.stringify({ type: "user", message: { content: "x" } })
      ).join("\n")
    );

    const results = searchSessions({
      homeDir: testDir,
      latest: 10,
      minTurns: 1,
    });

    expect(results).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify failure**

```bash
cd tools/siv && npx vitest run tests/sessions/search.test.ts
```

**Step 3: Write implementation**

Port `search_sessions.py` to TypeScript. Key function signatures:

```typescript
// tools/siv/src/sessions/search.ts
import fs from "fs";
import path from "path";
import readline from "readline";

const MAX_SESSIONS = 20;
const DEFAULT_LATEST = 5;
const DEFAULT_MIN_TURNS = 3;

export function pathToProjectKey(projectPath: string): string {
  const normalized = projectPath.replace(/\/+$/, "");
  return normalized.replace(/\//g, "-").replace(/_/g, "-");
}

export function countTurns(jsonlPath: string): number {
  // Read line-by-line, count type="user" with string content
  // Skip tool_result records (content is array with tool_result items)
  // Port from Python's count_turns()
}

export interface SearchOptions {
  projectPath?: string;
  since?: string;       // YYYY-MM-DD
  date?: string;        // YYYY-MM-DD
  latest?: number;
  minTurns?: number;
  homeDir?: string;     // For testing — override HOME
}

export interface SessionInfo {
  path: string;
  session_id: string;
  modified: string;
  size_bytes: number;
  turn_count: number;
}

export function searchSessions(options: SearchOptions = {}): SessionInfo[] {
  // Port from Python's search_sessions()
  // 1. Resolve projects dir from homeDir or HOME
  // 2. If projectPath given, convert to key and search only that dir
  // 3. Else search all project dirs
  // 4. Collect *.jsonl files, skip "subagents" in path
  // 5. Filter by since/date
  // 6. Sort by mtime descending
  // 7. Apply minTurns filter and latest cap
}
```

Implement the full port — the Python is ~100 lines of logic, straightforward to convert.

**Step 4: Run tests**

```bash
cd tools/siv && npx vitest run tests/sessions/search.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tools/siv/src/sessions/ tools/siv/tests/sessions/
git commit -m "feat(siv): port session search from Python"
```

---

## Phase 4: Session Extraction (port from Python)

This is the largest component (~826 lines Python). Break into sub-tasks.

### Task 6: Core parser and record classifier

**Files:**
- Create: `tools/siv/src/sessions/extract.ts`
- Create: `tools/siv/tests/sessions/extract.test.ts`

Port `parse_jsonl()`, `classify_record()`, `is_main_session()` from `extract_session.py`.

**Step 1: Write failing tests**

```typescript
// tools/siv/tests/sessions/extract.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

describe("parseJsonl", () => {
  // Test: reads valid JSONL, skips malformed lines, handles empty file
});

describe("classifyRecord", () => {
  // Test each category: human_message, tool_result, assistant,
  // agent_progress, bash_progress, hook_progress, turn_duration,
  // api_error, compact_boundary, summary, queue_operation, skip
  // Port test cases from test_extract.py
});

describe("isMainSession", () => {
  // Test: returns true for main session, false for subagent (isSidechain),
  // false for subagent (agentId), false for empty file
});
```

Port the corresponding tests from `skills/claude-session-analyst/scripts/test_extract.py`. The test file has comprehensive test cases for every classifier category.

**Step 2: Run tests, verify failure**

**Step 3: Implement** — port `parse_jsonl()`, `classify_record()`, `is_main_session()` from Python.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git commit -m "feat(siv): port JSONL parser and record classifier"
```

---

### Task 7: Metadata extraction

**Files:**
- Modify: `tools/siv/src/sessions/extract.ts`
- Modify: `tools/siv/tests/sessions/extract.test.ts`

Port `extract_metadata()` from `extract_session.py`.

**Step 1: Write failing tests** — test metadata extraction: session_id, slug, cwd, git_branch, model, version, timestamps, token totals, turn_count, turn_durations.

**Step 2: Run tests, verify failure**

**Step 3: Implement `extractMetadata()`**

Key fields to extract from records:
- Session-level: sessionId, slug, cwd, gitBranch, version (from first record that has them)
- Timestamps: first and last `timestamp` fields
- Model: from assistant record `message.model`
- Tokens: sum `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` from assistant records
- Turn durations: from `system`/`turn_duration` records, `durationMs` field

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git commit -m "feat(siv): port metadata extraction"
```

---

### Task 8: Conversation flow extraction

**Files:**
- Modify: `tools/siv/src/sessions/extract.ts`
- Modify: `tools/siv/tests/sessions/extract.test.ts`

Port `extract_conversation()` and helpers: `_build_tool_name_map()`, `_truncate()`, `_summarize_tool_input()`, `_extract_tool_result_content()`.

This is the most complex extractor (~200 lines Python). Key behaviors:
- Collapses skill-content dumps into `{type: "skill_loaded", skill_name, size}` stubs
- Drops compaction summaries
- Groups assistant records by message.id (multiple records can share same id)
- Summarizes tool inputs per tool type (Write/Edit/Read/Bash/Agent/Grep/Glob)
- Only includes error tool results individually; counts successful ones
- Handles AskUserQuestion specially (keep answers, skip rejections)

**Step 1: Write failing tests** for each behavior above.

**Step 2: Run tests, verify failure**

**Step 3: Implement** — port all conversation extraction logic.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git commit -m "feat(siv): port conversation flow extraction"
```

---

### Task 9: Signal extractors

**Files:**
- Modify: `tools/siv/src/sessions/extract.ts`
- Modify: `tools/siv/tests/sessions/extract.test.ts`

Port remaining extractors:
- `extract_skills()` — Skill tool invocations
- `extract_subagents()` — Agent/Task tool invocations with agentId/duration/tokens parsing
- `extract_tool_failures()` — tool results with is_error=true
- `extract_api_errors()` — system api_error records
- `extract_tool_usage_summary()` — per-tool success/failure counts
- `extract_compactions()` — compact_boundary records

**Step 1: Write failing tests** for each extractor.

**Step 2: Run tests, verify failure**

**Step 3: Implement all extractors.**

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git commit -m "feat(siv): port signal extractors"
```

---

### Task 10: Full extraction pipeline

**Files:**
- Modify: `tools/siv/src/sessions/extract.ts`
- Modify: `tools/siv/tests/sessions/extract.test.ts`

Port `find_subagent_files()`, `extract_session()`, `extract_subsession()`.

The `extractSession()` function ties everything together:
1. Check `isMainSession()`
2. Parse JSONL
3. Run all extractors
4. Find subagent files
5. Return combined result

**Step 1: Write failing test** — create a realistic session JSONL fixture, run `extractSession()`, verify the shape of the output.

**Step 2: Run test, verify failure**

**Step 3: Implement pipeline functions.**

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git commit -m "feat(siv): port full extraction pipeline"
```

---

## Phase 5: LLM Client

### Task 11: LLM completion wrapper

**Files:**
- Create: `tools/siv/src/llm.ts`
- Create: `tools/siv/tests/llm.test.ts`

Wrap the Claude Agent SDK to make single-completion LLM calls that return structured JSON.

**Step 1: Write failing test**

```typescript
// tools/siv/tests/llm.test.ts
import { describe, it, expect, vi } from "vitest";
import { callLLM } from "../src/llm.js";

describe("callLLM", () => {
  it("returns parsed JSON from model response", async () => {
    // This test will need to mock the SDK
    // For now, test the response parsing logic
  });

  it("throws on invalid JSON response", async () => {
    // Test that non-JSON responses throw a clear error
  });
});
```

**Step 2: Implement**

```typescript
// tools/siv/src/llm.ts
import type { SivConfig } from "./config.js";

export interface LLMResponse<T> {
  result: T;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callLLM<T>(
  config: SivConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse<T>> {
  // Use Claude Agent SDK with config.apiBase and config.model
  // Send system + user prompt
  // Parse response as JSON
  // Return typed result + usage stats
  //
  // The SDK call will look something like:
  // const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.apiBase });
  // const response = await client.messages.create({
  //   model: config.model,
  //   system: systemPrompt,
  //   messages: [{ role: "user", content: userPrompt }],
  //   max_tokens: 4096,
  // });
  //
  // Note: Since we're using deepseek via compatible API, the exact SDK
  // usage may need adjustment. Implement based on what works with the
  // Claude Agent SDK + deepseek endpoint.
}
```

**Note:** The exact SDK integration depends on how Claude Agent SDK works with deepseek's endpoint. The user said they're compatible. Implement the simplest working version first, then adjust.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git commit -m "feat(siv): add LLM completion wrapper"
```

---

## Phase 6: `siv analyze`

### Task 12: Analysis prompt and instruction builder

**Files:**
- Create: `tools/siv/src/commands/analyze.ts`
- Create: `tools/siv/src/prompts/analyze.ts`

**Step 1: Create the analysis prompt template**

Derive from `skills/session-subagent-analyst/SKILL.md`. The prompt tells the LLM to analyze a condensed transcript and return findings as JSON.

```typescript
// tools/siv/src/prompts/analyze.ts

export function buildAnalyzePrompt(condensedJson: string): {
  system: string;
  user: string;
} {
  return {
    system: `You are a session analyst. Analyze Claude Code session transcripts and identify learnings and errors.

## What to Look For

**Learnings (LRN):** Forward-looking behavioral observations.
- best_practice: agent used suboptimal approach, better one exists
- correction: user explicitly corrected the agent
- knowledge_gap: agent lacked knowledge a skill could provide
- insight: non-trivial suggestion for improving workflows

**Errors (ERR):** Actual failures that cost time/tokens.
- Command returned non-zero exit code
- Tool call returned is_error: true
- API errors
- Doom loops (3+ attempts at same failing operation)

## Reporting Criteria

Report when:
- User explicitly corrects agent behavior
- Agent used wrong tool (sed instead of Edit, cat instead of Read)
- Agent spawned subagent for a single tool call
- Tool failures occurred
- Agent hit doom loops

Do NOT report:
- Normal successful tool usage
- Style inferences from how user writes
- Obvious observations like "agent used Read to read a file"

## Output Format

Return ONLY valid JSON:
{
  "findings": [
    {
      "category": "best_practice|correction|error|knowledge_gap|feature_request",
      "summary": "one-line description",
      "details": "full context with evidence",
      "priority": "low|medium|high|critical",
      "tags": ["tag1"]
    }
  ]
}

If no findings, return {"findings": []}`,

    user: `Analyze this session transcript:\n\n${condensedJson}`,
  };
}
```

**Step 2: Implement the analyze command**

```typescript
// tools/siv/src/commands/analyze.ts
import { searchSessions } from "../sessions/search.js";
import { extractSession } from "../sessions/extract.js";
import { executeLog } from "./log.js";
import { loadConfig } from "../config.js";
import { callLLM } from "../llm.js";
import { buildAnalyzePrompt } from "../prompts/analyze.js";

export interface AnalyzeOptions {
  latest?: number;
  projectPath?: string;
  since?: string;
  session?: string;
}

interface AnalyzeFinding {
  category: string;
  summary: string;
  details: string;
  priority: string;
  tags: string[];
}

export async function executeAnalyze(options: AnalyzeOptions): Promise<void> {
  const config = loadConfig();

  // 1. Find sessions
  const sessions = searchSessions({
    projectPath: options.projectPath,
    since: options.since,
    latest: options.latest || 5,
    minTurns: 3,
  });

  if (sessions.length === 0) {
    console.log("No sessions found matching criteria.");
    return;
  }

  console.log(`Found ${sessions.length} session(s) to analyze.`);

  // 2. Process each session
  for (const session of sessions) {
    console.log(`\nAnalyzing session ${session.session_id}...`);

    // 2a. Preprocess
    const extracted = extractSession(session.path);
    if (!extracted) {
      console.log(`  Skipped (not a main session)`);
      continue;
    }

    const condensedJson = JSON.stringify(extracted, null, 2);

    // 2b. Call LLM
    const prompt = buildAnalyzePrompt(condensedJson);
    const response = await callLLM<{ findings: AnalyzeFinding[] }>(
      config,
      prompt.system,
      prompt.user
    );

    // 2c. Log each finding
    const findings = response.result.findings || [];
    console.log(`  Found ${findings.length} finding(s)`);

    // Derive project info from extracted metadata
    const projectPath = extracted.metadata.cwd || "";
    const project = projectPath.split("/").pop() || "";

    for (const finding of findings) {
      const result = executeLog({
        category: finding.category,
        summary: finding.summary,
        details: finding.details,
        priority: finding.priority || "medium",
        project,
        projectPath,
        session: session.session_id,
        source: "analyze",
        tags: (finding.tags || []).join(","),
        related: "",
      });
      console.log(`  Logged: ${result.id} — ${finding.summary}`);
    }
  }

  console.log("\nAnalysis complete.");
}
```

**Step 3: Wire into CLI**

Add to `tools/siv/src/index.ts`:

```typescript
program
  .command("analyze")
  .description("Analyze session transcripts for learnings")
  .option("--latest <n>", "Number of recent sessions", "5")
  .option("--project-path <path>", "Filter by project path")
  .option("--since <date>", "Sessions since date (YYYY-MM-DD)")
  .option("--session <id>", "Analyze specific session")
  .action(async (options) => {
    const { executeAnalyze } = await import("./commands/analyze.js");
    await executeAnalyze({
      latest: parseInt(options.latest),
      projectPath: options.projectPath,
      since: options.since,
      session: options.session,
    });
  });
```

**Step 4: Test manually**

```bash
cd tools/siv && npx tsx src/index.ts analyze --latest 1 --project-path /Users/meixueting/work/wolfhead_skills
```

Expected: Finds a session, extracts it, calls LLM, logs findings.

**Step 5: Commit**

```bash
git commit -m "feat(siv): implement 'siv analyze' command"
```

---

## Phase 7: `siv retrieve`

### Task 13: Implement `siv retrieve`

**Files:**
- Create: `tools/siv/src/commands/retrieve.ts`
- Create: `tools/siv/tests/commands/retrieve.test.ts`
- Modify: `tools/siv/src/index.ts`

**Step 1: Write failing test**

```typescript
// tools/siv/tests/commands/retrieve.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeRetrieve, projectPathToMemoryPath } from "../../src/commands/retrieve.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("projectPathToMemoryPath", () => {
  it("converts project path to MEMORY.md path", () => {
    const result = projectPathToMemoryPath(
      "/Users/me/work/my_project",
      "/home/testuser"
    );
    expect(result).toBe(
      "/home/testuser/.claude/projects/-Users-me-work-my-project/memory/MEMORY.md"
    );
  });
});

describe("executeRetrieve", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-retrieve-" + Date.now());

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("returns project MEMORY.md content", () => {
    const memDir = path.join(
      testDir,
      ".claude",
      "projects",
      "-Users-me-work-proj",
      "memory"
    );
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "MEMORY.md"), "# Project Memory\n- Rule 1\n");

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/proj", global: false, format: "text" },
      testDir
    );
    expect(result).toContain("Rule 1");
  });

  it("returns empty string for missing file", () => {
    const result = executeRetrieve(
      { projectPath: "/Users/me/work/nope", global: false, format: "text" },
      testDir
    );
    expect(result).toBe("");
  });

  it("concatenates project and global", () => {
    // Create project MEMORY.md
    const memDir = path.join(testDir, ".claude", "projects", "-p", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "MEMORY.md"), "project rule\n");

    // Create global MEMORY.md
    const globalDir = path.join(testDir, ".claude");
    fs.writeFileSync(path.join(globalDir, "MEMORY.md"), "global rule\n");

    const result = executeRetrieve(
      { projectPath: "/p", global: true, format: "text" },
      testDir
    );
    expect(result).toContain("project rule");
    expect(result).toContain("global rule");
  });
});
```

**Step 2: Run tests, verify failure**

**Step 3: Implement**

```typescript
// tools/siv/src/commands/retrieve.ts
import fs from "fs";
import path from "path";
import { pathToProjectKey } from "../sessions/search.js";

export interface RetrieveOptions {
  projectPath?: string;
  global: boolean;
  format: "text" | "json";
}

export function projectPathToMemoryPath(projectPath: string, homeDir?: string): string {
  const home = homeDir || process.env.HOME || require("os").homedir();
  const key = pathToProjectKey(projectPath);
  return path.join(home, ".claude", "projects", key, "memory", "MEMORY.md");
}

export function globalMemoryPath(homeDir?: string): string {
  const home = homeDir || process.env.HOME || require("os").homedir();
  return path.join(home, ".claude", "MEMORY.md");
}

export function executeRetrieve(options: RetrieveOptions, homeDir?: string): string {
  const parts: string[] = [];

  if (options.projectPath) {
    const memPath = projectPathToMemoryPath(options.projectPath, homeDir);
    if (fs.existsSync(memPath)) {
      parts.push(fs.readFileSync(memPath, "utf-8"));
    }
  }

  if (options.global) {
    const gPath = globalMemoryPath(homeDir);
    if (fs.existsSync(gPath)) {
      parts.push(fs.readFileSync(gPath, "utf-8"));
    }
  }

  return parts.join("\n---\n");
}
```

**Step 4: Wire into CLI and run tests**

**Step 5: Commit**

```bash
git commit -m "feat(siv): implement 'siv retrieve' command"
```

---

## Phase 8: `siv promote_finding`

### Task 14: Implement `siv promote_finding`

**Files:**
- Create: `tools/siv/src/commands/promote-finding.ts`
- Create: `tools/siv/src/prompts/promote.ts`
- Create: `tools/siv/tests/commands/promote-finding.test.ts`
- Modify: `tools/siv/src/index.ts`

**Step 1: Create the promotion prompt**

```typescript
// tools/siv/src/prompts/promote.ts

export interface PromoteWriterInput {
  rule: string;
  category: string;
  scope: "project" | "global";
  currentMemoryMd: string;
  currentClaudeMd: string;
  findingIds: string[];
}

export interface PromoteWriterOutput {
  action: "create" | "merge" | "supersede" | "skip";
  section: string;
  target_line?: string;
  entry: string;
  reason: string;
}

export function buildPromotePrompt(input: PromoteWriterInput): {
  system: string;
  user: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = input.findingIds.join(", ");

  return {
    system: `You integrate rules into MEMORY.md files. Given a new rule and the current file content, decide how to add it.

Rules:
1. If the rule already exists in CLAUDE.md → return action "skip"
2. If a semantically similar rule exists in MEMORY.md → return action "merge" (update confirmed date, append session IDs)
3. If a conflicting rule exists → return action "supersede" (provide replacement)
4. If the rule is new → return action "create" (append to appropriate section)

For merge/supersede, set target_line to the EXACT existing line to match.

Entry format for learnings: - <rule text> *(added: YYYY-MM-DD, confirmed: YYYY-MM-DD, sessions: id1, id2)*
Entry format for errors: - **<pattern>**: <how to avoid> *(added: YYYY-MM-DD, confirmed: YYYY-MM-DD, sessions: id1, id2)*

Return ONLY valid JSON.`,

    user: `New rule to promote:
- Category: ${input.category}
- Rule: "${input.rule}"
- Finding IDs: ${sessions}
- Today: ${today}

Current MEMORY.md:
---
${input.currentMemoryMd || "(empty)"}
---

Current CLAUDE.md (duplicate check only):
---
${input.currentClaudeMd || "(empty)"}
---

Return:
{
  "action": "create|merge|supersede|skip",
  "section": "## Session Learnings",
  "target_line": "(existing line for merge/supersede, omit for create)",
  "entry": "- the formatted entry line",
  "reason": "brief explanation"
}`,
  };
}
```

**Step 2: Write failing test for the promote logic**

```typescript
// tools/siv/tests/commands/promote-finding.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyPromotion } from "../../src/commands/promote-finding.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("applyPromotion", () => {
  const testDir = path.join(os.tmpdir(), "siv-test-promote-" + Date.now());

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it("creates new entry when file is empty", () => {
    const targetFile = path.join(testDir, "MEMORY.md");

    applyPromotion(targetFile, {
      action: "create",
      section: "## Session Learnings",
      entry: "- Always Read before Write *(added: 2026-03-05, confirmed: 2026-03-05, sessions: abc)*",
      reason: "new rule",
    });

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toContain("## Session Learnings");
    expect(content).toContain("Always Read before Write");
  });

  it("appends to existing section", () => {
    const targetFile = path.join(testDir, "MEMORY.md");
    fs.writeFileSync(targetFile, "# Project Memory\n\n## Session Learnings\n- Existing rule\n");

    applyPromotion(targetFile, {
      action: "create",
      section: "## Session Learnings",
      entry: "- New rule *(added: 2026-03-05, confirmed: 2026-03-05, sessions: abc)*",
      reason: "new rule",
    });

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toContain("Existing rule");
    expect(content).toContain("New rule");
  });

  it("replaces line on merge", () => {
    const targetFile = path.join(testDir, "MEMORY.md");
    fs.writeFileSync(
      targetFile,
      "# Project Memory\n\n## Session Learnings\n- Old rule *(added: 2026-03-04, confirmed: 2026-03-04, sessions: old)*\n"
    );

    applyPromotion(targetFile, {
      action: "merge",
      section: "## Session Learnings",
      target_line: "- Old rule *(added: 2026-03-04, confirmed: 2026-03-04, sessions: old)*",
      entry: "- Old rule *(added: 2026-03-04, confirmed: 2026-03-05, sessions: old, new)*",
      reason: "merged with new session",
    });

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toContain("confirmed: 2026-03-05");
    expect(content).toContain("sessions: old, new");
    expect(content).not.toContain("confirmed: 2026-03-04");
  });

  it("skips when action is skip", () => {
    const targetFile = path.join(testDir, "MEMORY.md");
    fs.writeFileSync(targetFile, "# Original\n");

    applyPromotion(targetFile, {
      action: "skip",
      section: "",
      entry: "",
      reason: "already in CLAUDE.md",
    });

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toBe("# Original\n");
  });
});
```

**Step 3: Run tests, verify failure**

**Step 4: Implement `applyPromotion()` and the full `executePromoteFinding()`**

The `applyPromotion()` function handles the mechanical file edit:
- `create`: find section or create it, append entry
- `merge`/`supersede`: find target_line, replace it with entry
- `skip`: do nothing

The `executePromoteFinding()` function orchestrates:
1. Determine target file path
2. Read current MEMORY.md and CLAUDE.md
3. Call LLM (sivAgent-Writer)
4. Backup target file
5. Apply the edit
6. Mark findings as promoted in findings.jsonl
7. Append to promotions.jsonl

**Step 5: Run tests, verify pass**

**Step 6: Wire into CLI**

**Step 7: Commit**

```bash
git commit -m "feat(siv): implement 'siv promote_finding' command"
```

---

## Phase 9: `siv run_promotion`

### Task 15: Implement `siv run_promotion`

**Files:**
- Create: `tools/siv/src/commands/run-promotion.ts`
- Create: `tools/siv/src/prompts/distill.ts`
- Create: `tools/siv/tests/commands/run-promotion.test.ts`
- Modify: `tools/siv/src/index.ts`

**Step 1: Write failing test for the grouping/threshold logic**

```typescript
// tools/siv/tests/commands/run-promotion.test.ts
import { describe, it, expect } from "vitest";
import { groupFindings, applyThresholds } from "../../src/commands/run-promotion.js";
import type { Finding } from "../../src/types.js";

const makeFinding = (overrides: Partial<Finding>): Finding => ({
  id: "LRN-001",
  ts: "2026-03-05T00:00:00Z",
  category: "best_practice",
  summary: "test",
  details: "",
  priority: "medium",
  project: "proj",
  project_path: "/path/proj",
  session: "s1",
  tags: [],
  related_files: [],
  source: "analyze",
  status: "pending",
  ...overrides,
});

describe("groupFindings", () => {
  it("groups by project and category", () => {
    const findings = [
      makeFinding({ id: "1", project: "a", category: "error", session: "s1" }),
      makeFinding({ id: "2", project: "a", category: "error", session: "s2" }),
      makeFinding({ id: "3", project: "a", category: "best_practice", session: "s1" }),
      makeFinding({ id: "4", project: "b", category: "error", session: "s3" }),
    ];
    const groups = groupFindings(findings);
    expect(groups).toHaveLength(3); // a:error, a:best_practice, b:error
  });
});

describe("applyThresholds", () => {
  it("passes groups with 2+ sessions", () => {
    const groups = [
      {
        project: "a",
        project_path: "/a",
        category: "error",
        findings: [
          makeFinding({ session: "s1" }),
          makeFinding({ session: "s2" }),
        ],
      },
    ];
    const candidates = applyThresholds(groups, { minSessions: 2, minOccurrences: 3, crossProjectMinProjects: 2 });
    expect(candidates).toHaveLength(1);
  });

  it("passes groups with 3+ occurrences even from 1 session", () => {
    const groups = [
      {
        project: "a",
        project_path: "/a",
        category: "error",
        findings: [
          makeFinding({ session: "s1" }),
          makeFinding({ session: "s1" }),
          makeFinding({ session: "s1" }),
        ],
      },
    ];
    const candidates = applyThresholds(groups, { minSessions: 2, minOccurrences: 3, crossProjectMinProjects: 2 });
    expect(candidates).toHaveLength(1);
  });

  it("rejects groups below threshold", () => {
    const groups = [
      {
        project: "a",
        project_path: "/a",
        category: "error",
        findings: [makeFinding({ session: "s1" })],
      },
    ];
    const candidates = applyThresholds(groups, { minSessions: 2, minOccurrences: 3, crossProjectMinProjects: 2 });
    expect(candidates).toHaveLength(0);
  });
});
```

**Step 2: Run tests, verify failure**

**Step 3: Implement grouping, threshold, and orchestration**

The `executeRunPromotion()` function:
1. Read findings.jsonl, filter `status: pending` within window
2. Call `groupFindings()` — group by `(project, category)`
3. Call `applyThresholds()` — filter by hard rules
4. If `--dry-run`, print candidates and exit
5. Call sivAgent-Promote (single LLM completion) to distill each group into a rule
6. For each returned promotion, call `executePromoteFinding()` internally

**Step 4: Create distillation prompt**

```typescript
// tools/siv/src/prompts/distill.ts

export interface FindingGroup {
  group_id: number;
  project: string;
  project_path: string;
  scope: "project" | "global";
  category: string;
  findings: Array<{ id: string; summary: string; details: string; session: string }>;
}

export function buildDistillPrompt(groups: FindingGroup[]): {
  system: string;
  user: string;
} {
  return {
    system: `You distill groups of related findings into concise actionable rules.

For each group, produce ONE rule that captures the pattern. Rules should be:
- Short (one sentence)
- Actionable (what to do or avoid)
- Forward-looking (prevention, not incident report)

Return ONLY valid JSON.`,

    user: `Distill these finding groups into promotion rules:

${JSON.stringify(groups, null, 2)}

Return:
{
  "promotions": [
    {
      "finding_ids": ["LRN-...", "LRN-..."],
      "scope": "project|global",
      "project": "project_name",
      "project_path": "/path",
      "category": "learning|error|preference",
      "rule": "concise actionable rule text"
    }
  ]
}`,
  };
}
```

**Step 5: Run tests, verify pass**

**Step 6: Wire into CLI**

**Step 7: Test end-to-end manually**

```bash
cd tools/siv && npx tsx src/index.ts run_promotion --dry-run
```

**Step 8: Commit**

```bash
git commit -m "feat(siv): implement 'siv run_promotion' command"
```

---

## Phase 10: `siv status`

### Task 16: Implement `siv status`

**Files:**
- Create: `tools/siv/src/commands/status.ts`
- Modify: `tools/siv/src/index.ts`

**Step 1: Implement** — reads findings.jsonl and promotions.jsonl, prints stats.

No LLM call. Straightforward:
- Total findings by status (pending/promoted/dismissed)
- By category breakdown
- By project breakdown
- Recent promotions (last 10)
- Age distribution (findings older than 7/14/30 days)

**Step 2: Wire into CLI**

**Step 3: Test manually**

```bash
cd tools/siv && npx tsx src/index.ts status
```

**Step 4: Commit**

```bash
git commit -m "feat(siv): implement 'siv status' command"
```

---

## Phase 11: SKILL.md

### Task 17: Write the agent-facing SKILL.md

**Files:**
- Create: `skills/siv/SKILL.md`

Write the minimal ~30-line skill file as specified in the design doc. This is what Agent (Claude Code) loads — it only documents `siv log` for optional real-time capture.

**Step 1: Write SKILL.md**

See the "SKILL.md (Agent-Facing)" section in the design doc for the exact content.

**Step 2: Commit**

```bash
git add skills/siv/
git commit -m "feat(siv): add agent-facing SKILL.md"
```

---

## Phase 12: Integration Test

### Task 18: End-to-end smoke test

**Files:**
- Create: `tools/siv/tests/e2e/smoke.test.ts`

Write an integration test that exercises the full pipeline:
1. `siv log` — log 3 findings for same project from 2 sessions
2. `siv status` — verify counts
3. `siv run_promotion --dry-run` — verify candidates detected
4. `siv retrieve` — verify returns content (or empty)

Mock the LLM calls (don't hit real API in tests).

**Step 1: Write and run integration test**

**Step 2: Commit**

```bash
git commit -m "test(siv): add end-to-end smoke test"
```

---

## Task Summary

| Task | Phase | Description | Estimated Steps |
|------|-------|-------------|-----------------|
| 1 | Scaffolding | Init project, package.json, tsconfig | 8 |
| 2 | Scaffolding | Config and .env loader | 5 |
| 3 | Scaffolding | Storage layer (JSONL, IDs) | 5 |
| 4 | Log | `siv log` command | 7 |
| 5 | Search | Port search_sessions.py | 5 |
| 6 | Extract | Core parser + classifier | 5 |
| 7 | Extract | Metadata extraction | 5 |
| 8 | Extract | Conversation extraction | 5 |
| 9 | Extract | Signal extractors | 5 |
| 10 | Extract | Full pipeline | 5 |
| 11 | LLM | Completion wrapper | 4 |
| 12 | Analyze | `siv analyze` command | 5 |
| 13 | Retrieve | `siv retrieve` command | 5 |
| 14 | Promote | `siv promote_finding` command | 7 |
| 15 | Promotion | `siv run_promotion` command | 8 |
| 16 | Status | `siv status` command | 4 |
| 17 | Skill | Agent-facing SKILL.md | 2 |
| 18 | Test | E2E smoke test | 2 |
