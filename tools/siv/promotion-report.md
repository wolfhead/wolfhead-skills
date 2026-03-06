# Promotion Report

Generated: 2026-03-05
Total promotions: 4
Total findings: 24

---

## Promotion 1: `PRM-20260305-247`

- **Project:** generic-wiggling-cupcake
- **Category:** best_practice
- **Action:** create
- **Status:** active

### Merged Rule

> When creating findings/rules, use self-contained 'when X, do Y' summaries that exclude one-time config fixes. Track processed items with rich metadata (session_id, scan_time, file_modified, line_count, findings_count) to enable intelligent deduplication and only re-scan when files grow significantly.

### Source Findings (3)

#### `LRN-20260305-808`

**Summary:** When designing output formats for findings/rules, make summaries self-contained with enough context to be understood without reading details — use 'when X, do Y' format

**Details:** Initial findings were narrative-style and required reading details. User guided to use imperative rule format ('When connecting to proxy API, ask for exact base URL') that's actionable on its own.

**Tags:** output-format, findings, prompt-design

#### `LRN-20260305-8a5`

**Summary:** When filtering findings for quality, exclude one-time config fixes and tool-specific trivia — only report reusable patterns that will recur

**Details:** Initial findings included 'set max_tokens to 16384' and 'use @skills/... shortcut' which are one-time fixes. Updated prompt to filter these out per user guidance.

**Tags:** filtering, finding-quality, prompt-design

#### `LRN-20260305-42b`

**Summary:** When tracking processed items for deduplication, store rich metadata (session_id, scan_time, file_modified, line_count, findings_count, error_message) to enable intelligent re-scan decisions

**Details:** User proposed storing scan metadata in JSONL format. Enabled skipping already-scanned sessions and only re-scanning when file grew by 3+ lines, preventing duplicate findings.

**Tags:** deduplication, metadata, scan-tracking

---

## Promotion 2: `PRM-20260305-805`

- **Project:** pure-hopping-firefly
- **Category:** best_practice
- **Action:** create
- **Status:** active

### Merged Rule

> When building CLI tools with LLM agents, have agents return structured JSON for the CLI to process internally rather than calling CLI commands as tools. For file edits, request structured edit instructions (action + target + content) instead of full files. Dispatch large coupled codebase ports to single subagents to maintain context.

### Source Findings (3)

#### `LRN-20260305-ed2`

**Summary:** When a CLI tool invokes LLM agents for decision-making, have agents return structured JSON output and let the CLI handle all I/O internally — instead of having agents call CLI commands as tools or spawn nested agents

**Details:** The design evolved from agents calling `siv log`/`siv promote_finding` as tools to agents returning structured JSON that sivCode processes internally. This eliminated nested agent spawning, simplified debugging, and made each LLM call a single completion with no tool loop.

**Tags:** agent-design, cli-architecture, llm-integration

#### `LRN-20260305-863`

**Summary:** When using an LLM to edit existing files, ask for structured edit instructions (action + target + new content) instead of having the LLM return the entire file — reduces token cost and prevents accidental corruption of unchanged content

**Details:** The agent initially proposed having the LLM return full MEMORY.md content with edits applied. Switched to returning structured JSON like `{action: 'merge', target_line: '...', replacement: '...'}` which is cheaper and safer since sivCode applies edits mechanically.

**Tags:** llm-integration, file-editing, token-efficiency

#### `LRN-20260305-999`

**Summary:** When porting a large coupled codebase (like a multi-function pipeline), dispatch all related tasks to a single subagent rather than splitting them — maintains context and reduces integration issues

**Details:** Tasks 6-10 (the ~826 line extraction pipeline port) were dispatched as one unit to a single subagent instead of 5 separate tasks. Resulted in 120 tests passing with no integration gaps between the parser, metadata extractor, conversation extractor, and signal extractors.

**Tags:** subagent-driven-development, code-porting, task-batching

---

## Promotion 3: `PRM-20260305-ea0`

- **Project:** glistening-sniffing-melody
- **Category:** best_practice
- **Action:** create
- **Status:** active

### Merged Rule

> When analyzing tool results, filter out AskUserQuestion rejections as conversational redirects, not errors. Always Read files before Write/Edit operations to verify target location. Check file existence with 'test -f' before Read operations, especially when running parallel Reads to prevent cascade failures.

### Source Findings (3)

#### `LRN-20260305-2de`

**Summary:** When categorizing tool results for analysis, don't treat AskUserQuestion rejections as tool failures — they are conversational redirects, not technical errors, and should be filtered out of error reports

**Details:** AskUserQuestion rejections were shown as 'The user doesn't want to proceed' in tool_failures, misleading the subagent into thinking these were errors. They're actually user decisions to continue discussion, not tool breakage.

**Tags:** tool-categorization, error-reporting, AskUserQuestion

#### `LRN-20260305-3fe`

**Summary:** When writing or editing files, always Read the file first — even for new files — to verify the target location and avoid constraint violations

**Details:** This pattern appeared in 5 of 8 analyzed sessions. Agents attempted Write/Edit without verifying file state first, causing repeated errors across multiple sessions.

**Tags:** file-operations, Read-before-Write, tool-constraints

#### `LRN-20260305-d85`

**Summary:** When reading files at uncertain paths, check existence with 'test -f' before Read — especially when running parallel Reads to prevent cascade failures

**Details:** 3 sessions showed failures from reading non-existent files (like MEMORY.md). Parallel Reads on uncertain paths caused sibling tool call cascades when files didn't exist.

**Tags:** file-operations, existence-check, parallel-operations

---

## Promotion 4: `PRM-20260305-c0e`

- **Project:** _(cross-project)_
- **Category:** best_practice
- **Action:** create
- **Status:** active

### Merged Rule

> When updating classification logic in skills with shared outputs, check downstream consumers to identify which files actually contain the rules. Add explicit concept definitions before updating implementation details. When multiple skills have overlapping taxonomies, align simpler ones to richer existing models rather than inventing new schemes.

### Source Findings (3)

#### `LRN-20260305-1e4`

**Summary:** When updating classification logic in a skill that produces shared output files, check downstream consumers to confirm which skills actually contain the classification rules before assuming multiple files need changes

**Details:** User prompted the agent to verify if claude-session-analyst needed updates; the agent checked and confirmed only session-subagent-analyst contained classification logic while the orchestrator and promoter were classification-agnostic.

**Tags:** skill-maintenance, dependency-analysis, classification

#### `LRN-20260305-aa4`

**Summary:** When clarifying ambiguous conceptual boundaries (like learning vs error), first add explicit concept definitions before updating implementation details like category mappings and examples

**Details:** The agent added a 'Concepts' section defining LRN as forward-looking behavioral rules and ERR as backward-looking failure records, which made subsequent updates to mappings, criteria, and examples consistent and clear.

**Tags:** documentation, conceptual-clarity, skill-design

#### `LRN-20260305-84c`

**Summary:** When multiple related skills have overlapping taxonomies, align the simpler one to the richer existing model rather than inventing new classification schemes

**Details:** The agent discovered self-improving-agent-claude had a clearer LRN/ERR model (ERR=actual failures, LRN=behavioral observations) and aligned session-subagent-analyst to it instead of creating a new taxonomy.

**Tags:** consistency, taxonomy, skill-alignment

---

## Unpromoted Findings (12)

These findings did not meet promotion thresholds (minSessions=2 or minOccurrences=3).

### [error] fancy-wobbling-treasure — 1 finding(s), 1 session(s)

- `ERR-20260305-fc9` When the user rejects a tool call with a stop message, abandon that search path immediately rather than retrying similar searches

### [knowledge_gap] fancy-wobbling-treasure — 1 finding(s), 1 session(s)

- `LRN-20260305-33e` When searching for documentation files to merge, use broader search patterns that include variations like 'best-practices', 'design', and 'reference' — not just 'guide' and 'author'

### [correction] generic-wiggling-cupcake — 1 finding(s), 1 session(s)

- `LRN-20260305-9f9` When adding new features or changing existing behavior, get explicit user approval before implementing — don't assume the direction is correct

### [error] generic-wiggling-cupcake — 2 finding(s), 1 session(s)

- `ERR-20260305-e36` When debugging LLM API 400 errors, systematically isolate the cause using binary search on input and test parameters individually — don't assume it's a content filter or size issue
- `ERR-20260305-cfe` When setting max_tokens for LLM calls, don't assume higher values work — verify the model's actual output token limits to avoid 400 errors

### [knowledge_gap] generic-wiggling-cupcake — 2 finding(s), 1 session(s)

- `LRN-20260305-33c` When connecting to a proxy or alternative API endpoint, ask the user for the exact base URL before guessing URL patterns or switching SDKs
- `LRN-20260305-c5d` When configuring LLM parameters for non-OpenAI models, verify which OpenAI-specific parameters (like response_format) are actually supported by that model/provider

### [knowledge_gap] glistening-sniffing-melody — 1 finding(s), 1 session(s)

- `LRN-20260305-1c7` When condensing session data for subagent analysis, preserve successful tool results with their content and add a tool_usage_summary with per-tool success/failure counts — don't drop successful results into aggregate counts only

### [knowledge_gap] pure-hopping-firefly — 1 finding(s), 1 session(s)

- `LRN-20260305-ee8` When referencing existing skills in the wolfhead_skills project, use the actual skill name (e.g., 'claude-self-improver') not the directory name (e.g., 'self-improving-agent-claude')

### [best_practice] wobbly-snuggling-hellman — 1 finding(s), 1 session(s)

- `LRN-20260305-74d` When specifying a model for subagent tasks, add fallback logic (e.g., 'haiku if available, otherwise cheapest/fastest') since subagents may not have access to all models

### [error] wobbly-snuggling-hellman — 1 finding(s), 1 session(s)

- `ERR-20260305-150` When editing a file, always read it first — don't attempt Edit tool calls without a prior Read, even if you think you know the content

### [knowledge_gap] wobbly-snuggling-hellman — 1 finding(s), 1 session(s)

- `LRN-20260305-a70` When accessing skill files, don't assume the default ~/.claude/skills/ path — check the project's actual skills directory (e.g., /Users/.../wolfhead_skills/skills/) first

