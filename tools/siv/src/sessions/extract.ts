/**
 * Extract structured signals from Claude Code JSONL session files.
 *
 * Parses session JSONL and produces condensed JSON with metadata,
 * conversation flow, tool usage, subagent activity, and error signals.
 *
 * Ported from Python: skills/claude-session-analyst/scripts/extract_session.py
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Enough context for analysis without bloating output */
export const CONTENT_PREVIEW_MAX_CHARS = 500;
/** Tool call inputs: keep key params, drop file content */
export const TOOL_INPUT_MAX_CHARS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordCategory =
  | "human_message"
  | "tool_result"
  | "assistant"
  | "agent_progress"
  | "bash_progress"
  | "hook_progress"
  | "turn_duration"
  | "api_error"
  | "compact_boundary"
  | "summary"
  | "queue_operation"
  | "skip";

export interface SessionMetadata {
  session_id: string | null;
  slug: string | null;
  cwd: string | null;
  git_branch: string | null;
  model: string | null;
  version: string | null;
  first_timestamp: string | null;
  last_timestamp: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  turn_count: number;
  turn_durations: number[];
}

export interface ToolCall {
  tool_use_id: string;
  name: string;
  input: unknown;
}

export interface HumanMessageTurn {
  type: "human_message";
  text: string;
}

export interface AssistantTurn {
  type: "assistant_turn";
  message_id: string;
  text: string;
  tool_calls: ToolCall[];
}

export interface ToolResultTurn {
  type: "tool_result";
  tool_use_id: string;
  tool_name: string;
  is_error: boolean;
  content_preview: string;
}

export interface SkillLoadedTurn {
  type: "skill_loaded";
  skill_name: string;
  size: number;
}

export interface ToolResultsSummaryTurn {
  type: "tool_results_summary";
  successful_tool_results: number;
  note: string;
}

export type ConversationTurn =
  | HumanMessageTurn
  | AssistantTurn
  | ToolResultTurn
  | SkillLoadedTurn
  | ToolResultsSummaryTurn;

export interface SkillInfo {
  skill_name: string;
  args: string;
  tool_use_id: string;
  result: string | null;
}

export interface SubagentInfo {
  description: string;
  prompt: string;
  subagent_type: string;
  tool_use_id: string;
  agent_id: string | null;
  status: string | null;
  duration: number | null;
  tokens: number | null;
}

export interface ToolFailure {
  tool_use_id: string;
  tool_name: string;
  content_preview: string;
}

export interface ApiError {
  cause: unknown;
  retry_attempt: number | undefined;
  max_retries: number | undefined;
  retry_in_ms: number | undefined;
  timestamp: string | undefined;
}

export interface ToolUsageEntry {
  success: number;
  failure: number;
}

export interface CompactionInfo {
  timestamp: string | undefined;
  trigger: string | null;
  pre_tokens: number | null;
  content: unknown;
}

export interface EmotionMarker {
  type: string;
  context: string;
  turn_index: number; // 0-based human-turn counter
}

export interface SessionExtraction {
  metadata: SessionMetadata;
  conversation: ConversationTurn[];
  skills: SkillInfo[];
  subagents: SubagentInfo[];
  tool_failures: ToolFailure[];
  tool_usage_summary: Record<string, ToolUsageEntry>;
  api_errors: ApiError[];
  compactions: CompactionInfo[];
  subagent_files: string[];
  emotion_markers: EmotionMarker[];
}

export interface SubsessionExtraction {
  metadata: SessionMetadata;
  conversation: ConversationTurn[];
  skills: SkillInfo[];
  subagents: SubagentInfo[];
  tool_failures: ToolFailure[];
  tool_usage_summary: Record<string, ToolUsageEntry>;
  api_errors: ApiError[];
  compactions: CompactionInfo[];
  emotion_markers: EmotionMarker[];
}

// Use Record<string, unknown> as the base record type
type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Task 6 — Core parser + classifier
// ---------------------------------------------------------------------------

/**
 * Read a JSONL file and return a list of parsed objects, skipping malformed lines.
 */
export function parseJsonl(filePath: string): Rec[] {
  const records: Rec[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line) as Rec);
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

/**
 * Classify a parsed JSONL record into a semantic category.
 */
export function classifyRecord(record: Rec): RecordCategory {
  const rtype = record.type;

  if (rtype === "user") {
    const msg = (record.message ?? {}) as Rec;
    const content = msg.content;
    if (Array.isArray(content)) {
      if (
        content.some(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            (item as Rec).type === "tool_result"
        )
      ) {
        return "tool_result";
      }
      return "human_message";
    }
    return "human_message";
  }

  if (rtype === "assistant") return "assistant";

  if (rtype === "progress") {
    const data = (record.data ?? {}) as Rec;
    const dtype = data.type ?? "";
    if (dtype === "agent_progress") return "agent_progress";
    if (dtype === "bash_progress") return "bash_progress";
    if (dtype === "hook_progress") return "hook_progress";
    return "skip";
  }

  if (rtype === "system") {
    const subtype = record.subtype ?? "";
    if (subtype === "turn_duration") return "turn_duration";
    if (subtype === "api_error") return "api_error";
    if (subtype === "compact_boundary") return "compact_boundary";
    return "skip";
  }

  if (rtype === "summary") return "summary";
  if (rtype === "queue-operation") return "queue_operation";

  // file-history-snapshot, saved_hook_context, unknown
  return "skip";
}

/**
 * Check if a JSONL file is a main session (not a subagent).
 *
 * Reads the first record: returns false if isSidechain=true or agentId present.
 */
export function isMainSession(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let record: Rec;
      try {
        record = JSON.parse(line) as Rec;
      } catch {
        continue;
      }
      if (record.isSidechain === true) return false;
      if (record.agentId) return false;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Task 7 — Metadata extraction
// ---------------------------------------------------------------------------

/**
 * Extract session metadata from a list of parsed records.
 */
export function extractMetadata(records: Rec[]): SessionMetadata {
  const meta: SessionMetadata = {
    session_id: null,
    slug: null,
    cwd: null,
    git_branch: null,
    model: null,
    version: null,
    first_timestamp: null,
    last_timestamp: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    turn_count: 0,
    turn_durations: [],
  };

  for (const rec of records) {
    if (meta.session_id === null && rec.sessionId) {
      meta.session_id = rec.sessionId as string;
    }
    if (meta.slug === null && rec.slug) {
      meta.slug = rec.slug as string;
    }
    if (meta.cwd === null && rec.cwd) {
      meta.cwd = rec.cwd as string;
    }
    if (meta.git_branch === null && rec.gitBranch) {
      meta.git_branch = rec.gitBranch as string;
    }
    if (meta.version === null && rec.version) {
      meta.version = rec.version as string;
    }

    const ts = rec.timestamp as string | undefined;
    if (ts) {
      if (meta.first_timestamp === null) {
        meta.first_timestamp = ts;
      }
      meta.last_timestamp = ts;
    }

    if (rec.type === "assistant") {
      const msg = (rec.message ?? {}) as Rec;
      if (meta.model === null && msg.model) {
        meta.model = msg.model as string;
      }
      const usage = msg.usage;
      if (typeof usage === "object" && usage !== null && !Array.isArray(usage)) {
        const u = usage as Rec;
        meta.input_tokens += (u.input_tokens as number) ?? 0;
        meta.output_tokens += (u.output_tokens as number) ?? 0;
        meta.cache_read_tokens += (u.cache_read_input_tokens as number) ?? 0;
        meta.cache_creation_tokens +=
          (u.cache_creation_input_tokens as number) ?? 0;
      }
    }

    if (rec.type === "system" && rec.subtype === "turn_duration") {
      const durationMs = rec.durationMs as number | undefined;
      if (durationMs !== undefined && durationMs !== null) {
        meta.turn_durations.push(durationMs);
        meta.turn_count += 1;
      }
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Task 8 — Conversation flow extraction
// ---------------------------------------------------------------------------

/**
 * Build a dict mapping tool_use_id -> tool_name from assistant records.
 */
export function buildToolNameMap(records: Rec[]): Map<string, string> {
  const toolMap = new Map<string, string>();
  for (const rec of records) {
    if (rec.type !== "assistant") continue;
    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Rec).type === "tool_use"
      ) {
        const b = block as Rec;
        toolMap.set((b.id as string) ?? "", (b.name as string) ?? "unknown");
      }
    }
  }
  return toolMap;
}

/**
 * Truncate text to maxLen characters, appending '...' if truncated.
 */
export function truncate(
  text: unknown,
  maxLen: number = CONTENT_PREVIEW_MAX_CHARS
): string {
  const s = typeof text === "string" ? text : String(text);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

/**
 * Summarize tool call input to key params only, dropping large content.
 */
export function summarizeToolInput(
  name: string,
  inp: unknown
): unknown {
  if (typeof inp !== "object" || inp === null || Array.isArray(inp)) {
    return inp;
  }
  const input = inp as Rec;

  if (name === "Write") {
    const summary: Rec = { file_path: input.file_path ?? "" };
    if ("content" in input) {
      summary.content = `(${(input.content as string).length} chars)`;
    }
    return summary;
  }

  if (name === "Edit") {
    const summary: Rec = { file_path: input.file_path ?? "" };
    if ("old_string" in input) {
      summary.old_string = truncate(input.old_string, 100);
    }
    if ("new_string" in input) {
      summary.new_string = truncate(input.new_string, 100);
    }
    return summary;
  }

  if (name === "Read") {
    const summary: Rec = { file_path: input.file_path ?? "" };
    for (const k of ["offset", "limit", "pages"]) {
      if (k in input) summary[k] = input[k];
    }
    return summary;
  }

  if (name === "Bash") {
    const summary: Rec = {};
    if ("command" in input) {
      summary.command = truncate(input.command, TOOL_INPUT_MAX_CHARS);
    }
    if ("description" in input) {
      summary.description = truncate(input.description, TOOL_INPUT_MAX_CHARS);
    }
    return summary;
  }

  if (name === "Agent" || name === "Task") {
    const summary: Rec = {};
    for (const k of [
      "description",
      "subagent_type",
      "model",
      "run_in_background",
    ]) {
      if (k in input) summary[k] = input[k];
    }
    if ("prompt" in input) {
      summary.prompt = `(${(input.prompt as string).length} chars)`;
    }
    return summary;
  }

  if (name === "Grep") {
    const summary: Rec = {};
    for (const k of ["pattern", "path", "glob", "type", "output_mode"]) {
      if (k in input) summary[k] = input[k];
    }
    return summary;
  }

  if (name === "Glob") {
    const summary: Rec = {};
    for (const k of ["pattern", "path"]) {
      if (k in input) summary[k] = input[k];
    }
    return summary;
  }

  // Generic: truncate the JSON representation
  const raw = JSON.stringify(inp);
  if (raw.length <= TOOL_INPUT_MAX_CHARS) {
    return inp;
  }
  return { _summary: truncate(raw, TOOL_INPUT_MAX_CHARS) };
}

/**
 * Extract string content from a tool_result content field.
 *
 * Content can be a string or an array of {type: "text", text: "..."}.
 */
export function extractToolResultContent(contentValue: unknown): string {
  if (typeof contentValue === "string") return contentValue;
  if (Array.isArray(contentValue)) {
    const parts: string[] = [];
    for (const item of contentValue) {
      if (
        typeof item === "object" &&
        item !== null &&
        (item as Rec).type === "text"
      ) {
        parts.push(((item as Rec).text as string) ?? "");
      } else if (typeof item === "string") {
        parts.push(item);
      }
    }
    return parts.join("\n");
  }
  return contentValue ? String(contentValue) : "";
}

/**
 * Extract the conversation flow as a list of turns.
 */
export function extractConversation(records: Rec[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const toolNameMap = buildToolNameMap(records);
  let successCount = 0;

  // Group assistant records by message.id
  const seenMessageIds = new Map<string, number>(); // message_id -> index in turns

  for (const rec of records) {
    const cat = classifyRecord(rec);

    if (cat === "human_message") {
      const msg = (rec.message ?? {}) as Rec;
      const content = msg.content;
      let text: string;
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        // Content blocks: extract text from {type: "text", text: "..."} blocks
        text = content
          .filter((b: unknown) => typeof b === "object" && b !== null && (b as Rec).type === "text")
          .map((b: unknown) => ((b as Rec).text as string) ?? "")
          .join("\n");
      } else {
        text = String(content);
      }

      // Collapse skill-content dumps into compact stubs
      if (text.slice(0, 200).includes("Base directory for this skill:")) {
        const firstLine = text.split("\n", 1)[0];
        const skillPath = firstLine
          .replace("Base directory for this skill:", "")
          .trim();
        const skillName = skillPath
          ? skillPath.replace(/\/$/, "").split("/").pop() ?? "unknown"
          : "unknown";
        turns.push({
          type: "skill_loaded",
          skill_name: skillName,
          size: text.length,
        });
        continue;
      }

      // Drop compaction summaries entirely
      if (
        text.startsWith(
          "This session is being continued from a previous conversation"
        )
      ) {
        continue;
      }

      turns.push({ type: "human_message", text });
    } else if (cat === "assistant") {
      const msg = (rec.message ?? {}) as Rec;
      const messageId = (msg.id as string) ?? "";
      const contentBlocks = msg.content;
      if (!Array.isArray(contentBlocks)) continue;

      const texts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of contentBlocks) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Rec;
        const btype = b.type;
        if (btype === "text") {
          const t = ((b.text as string) ?? "").trim();
          if (t) texts.push(t);
        } else if (btype === "tool_use") {
          const toolName = (b.name as string) ?? "";
          toolCalls.push({
            tool_use_id: (b.id as string) ?? "",
            name: toolName,
            input: summarizeToolInput(toolName, b.input ?? {}),
          });
        }
        // Skip thinking blocks
      }

      if (seenMessageIds.has(messageId)) {
        const idx = seenMessageIds.get(messageId)!;
        const existing = turns[idx] as AssistantTurn;
        if (texts.length > 0) {
          if (existing.text) {
            existing.text += "\n" + texts.join("\n");
          } else {
            existing.text = texts.join("\n");
          }
        }
        existing.tool_calls.push(...toolCalls);
      } else {
        const turn: AssistantTurn = {
          type: "assistant_turn",
          message_id: messageId,
          text: texts.join("\n"),
          tool_calls: toolCalls,
        };
        seenMessageIds.set(messageId, turns.length);
        turns.push(turn);
      }
    } else if (cat === "tool_result") {
      const msg = (rec.message ?? {}) as Rec;
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      for (const item of content) {
        if (typeof item !== "object" || item === null) continue;
        const it = item as Rec;
        if (it.type !== "tool_result") continue;
        const toolUseId = (it.tool_use_id as string) ?? "";
        const toolName = toolNameMap.get(toolUseId) ?? "unknown";
        const isError = (it.is_error as boolean) ?? false;

        // AskUserQuestion: keep successful answers, skip rejections
        if (toolName === "AskUserQuestion") {
          if (isError) continue;
          const rawContent = extractToolResultContent(it.content);
          turns.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            tool_name: toolName,
            is_error: false,
            content_preview: truncate(rawContent, 500),
          });
          continue;
        }

        if (isError) {
          const rawContent = extractToolResultContent(it.content);
          turns.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            tool_name: toolName,
            is_error: true,
            content_preview: truncate(rawContent, 500),
          });
        } else {
          successCount += 1;
        }
      }
    }
  }

  // Prepend a summary of successful tool results
  if (successCount > 0) {
    turns.unshift({
      type: "tool_results_summary",
      successful_tool_results: successCount,
      note: "Only error tool results are shown individually below.",
    });
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Task 9 — Signal extractors
// ---------------------------------------------------------------------------

/**
 * Extract Skill tool invocations with name, args, and result.
 */
export function extractSkills(records: Rec[]): SkillInfo[] {
  const skillCalls = new Map<string, SkillInfo>();

  // First pass: find Skill tool_use blocks
  for (const rec of records) {
    if (rec.type !== "assistant") continue;
    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Rec;
      if (b.type === "tool_use" && b.name === "Skill") {
        const inp = (b.input ?? {}) as Rec;
        const toolUseId = (b.id as string) ?? "";
        skillCalls.set(toolUseId, {
          skill_name: (inp.skill as string) ?? "",
          args: (inp.args as string) ?? "",
          tool_use_id: toolUseId,
          result: null,
        });
      }
    }
  }

  // Second pass: match tool results
  for (const rec of records) {
    const cat = classifyRecord(rec);
    if (cat !== "tool_result") continue;
    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as Rec;
      const tuid = (it.tool_use_id as string) ?? "";
      if (skillCalls.has(tuid)) {
        const raw = extractToolResultContent(it.content);
        skillCalls.get(tuid)!.result = truncate(raw, 500);
      }
    }
  }

  return Array.from(skillCalls.values());
}

/**
 * Extract Agent/Task (subagent) tool invocations.
 */
export function extractSubagents(records: Rec[]): SubagentInfo[] {
  const taskCalls = new Map<string, SubagentInfo>();

  for (const rec of records) {
    if (rec.type !== "assistant") continue;
    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Rec;
      if (
        b.type === "tool_use" &&
        (b.name === "Task" || b.name === "Agent")
      ) {
        const inp = (b.input ?? {}) as Rec;
        const toolUseId = (b.id as string) ?? "";
        taskCalls.set(toolUseId, {
          description: (inp.description as string) ?? "",
          prompt: truncate((inp.prompt as string) ?? "", 500),
          subagent_type: (inp.subagent_type as string) ?? "",
          tool_use_id: toolUseId,
          agent_id: null,
          status: null,
          duration: null,
          tokens: null,
        });
      }
    }
  }

  // Match tool results
  for (const rec of records) {
    const cat = classifyRecord(rec);
    if (cat !== "tool_result") continue;

    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as Rec;
      const tuid = (it.tool_use_id as string) ?? "";
      if (!taskCalls.has(tuid)) continue;

      const entry = taskCalls.get(tuid)!;

      // Extract agentId/status from toolUseResult
      const tur = rec.toolUseResult;
      if (typeof tur === "object" && tur !== null && !Array.isArray(tur)) {
        const t = tur as Rec;
        if (t.agentId) entry.agent_id = t.agentId as string;
        if (t.status) entry.status = t.status as string;
      }

      // Parse agent_id, duration, tokens from text content
      const raw = extractToolResultContent(it.content);

      const agentIdMatch = raw.match(
        /agentId:\s*([a-fA-F0-9][a-fA-F0-9-]+)/
      );
      if (agentIdMatch && !entry.agent_id) {
        entry.agent_id = agentIdMatch[1];
      }

      const durationMatch = raw.match(/duration_ms:\s*(\d+)/);
      if (durationMatch) {
        entry.duration = parseInt(durationMatch[1], 10);
      }

      const tokensMatch = raw.match(/total_tokens:\s*(\d+)/);
      if (tokensMatch) {
        entry.tokens = parseInt(tokensMatch[1], 10);
      }

      // Status from toolUseResult or infer from content
      if (!entry.status) {
        entry.status = "completed";
      }
    }
  }

  return Array.from(taskCalls.values());
}

/**
 * Extract tool results with is_error=true (skip AskUserQuestion).
 */
export function extractToolFailures(records: Rec[]): ToolFailure[] {
  const toolNameMap = buildToolNameMap(records);
  const failures: ToolFailure[] = [];

  for (const rec of records) {
    const cat = classifyRecord(rec);
    if (cat !== "tool_result") continue;
    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as Rec;
      if (it.type !== "tool_result") continue;
      if (!it.is_error) continue;
      const tuid = (it.tool_use_id as string) ?? "";
      const toolName = toolNameMap.get(tuid) ?? "unknown";
      if (toolName === "AskUserQuestion") continue;
      const raw = extractToolResultContent(it.content);
      failures.push({
        tool_use_id: tuid,
        tool_name: toolName,
        content_preview: truncate(raw, 500),
      });
    }
  }

  return failures;
}

/**
 * Extract system api_error records.
 */
export function extractApiErrors(records: Rec[]): ApiError[] {
  const errors: ApiError[] = [];
  for (const rec of records) {
    if (rec.type !== "system" || rec.subtype !== "api_error") continue;
    errors.push({
      cause: rec.cause,
      retry_attempt: rec.retryAttempt as number | undefined,
      max_retries: rec.maxRetries as number | undefined,
      retry_in_ms: rec.retryInMs as number | undefined,
      timestamp: rec.timestamp as string | undefined,
    });
  }
  return errors;
}

/**
 * Build per-tool success/failure counts.
 */
export function extractToolUsageSummary(
  records: Rec[]
): Record<string, ToolUsageEntry> {
  const toolNameMap = buildToolNameMap(records);
  const summary: Record<string, ToolUsageEntry> = {};

  for (const rec of records) {
    const cat = classifyRecord(rec);
    if (cat !== "tool_result") continue;
    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as Rec;
      if (it.type !== "tool_result") continue;
      const tuid = (it.tool_use_id as string) ?? "";
      const toolName = toolNameMap.get(tuid) ?? "unknown";
      if (!summary[toolName]) {
        summary[toolName] = { success: 0, failure: 0 };
      }
      if (it.is_error) {
        summary[toolName].failure += 1;
      } else {
        summary[toolName].success += 1;
      }
    }
  }

  return summary;
}

/**
 * Extract compact_boundary records.
 */
export function extractCompactions(records: Rec[]): CompactionInfo[] {
  const compactions: CompactionInfo[] = [];
  for (const rec of records) {
    if (rec.type !== "system" || rec.subtype !== "compact_boundary") continue;
    const cm = rec.compactMetadata;
    const isObj = typeof cm === "object" && cm !== null && !Array.isArray(cm);
    const cmRec = isObj ? (cm as Rec) : null;
    compactions.push({
      timestamp: rec.timestamp as string | undefined,
      trigger: cmRec ? (cmRec.trigger as string | null) ?? null : null,
      pre_tokens: cmRec ? (cmRec.preTokens as number | null) ?? null : null,
      content: rec.content,
    });
  }
  return compactions;
}

// ---------------------------------------------------------------------------
// Emotion marker extraction
// ---------------------------------------------------------------------------

/**
 * Extract emotion markers from Bash tool calls matching `siv mark <type> [context]`.
 */
export function extractEmotionMarkers(records: Rec[]): EmotionMarker[] {
  const markers: EmotionMarker[] = [];
  let humanCount = 0;

  for (const rec of records) {
    const cat = classifyRecord(rec);
    if (cat === "human_message") {
      humanCount++;
      continue;
    }
    if (rec.type !== "assistant") continue;
    // turn_index = number of human messages seen so far, 0-based.
    // A marker after the 1st human message gets index 0.
    const turnIndex = Math.max(0, humanCount - 1);

    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Rec;
      if (b.type !== "tool_use" || b.name !== "Bash") continue;

      const input = (b.input ?? {}) as Rec;
      const command = (input.command as string) ?? "";
      if (!command.startsWith("siv mark ")) continue;

      const afterMark = command.slice("siv mark ".length).trim();
      const parts = afterMark.match(/^(\S+)\s*(.*)/);
      if (!parts) continue;

      const markerType = parts[1];
      let context = parts[2].trim();
      if (
        (context.startsWith('"') && context.endsWith('"')) ||
        (context.startsWith("'") && context.endsWith("'"))
      ) {
        context = context.slice(1, -1);
      }

      markers.push({ type: markerType, context, turn_index: turnIndex });
    }
  }
  return markers;
}

// ---------------------------------------------------------------------------
// Task 10 — Full pipeline
// ---------------------------------------------------------------------------

/**
 * Discover subagent JSONL files relative to a session file.
 *
 * Given a session file at <dir>/<session-uuid>.jsonl, looks for
 * <dir>/<session-uuid>/subagents/agent-*.jsonl.
 */
export function findSubagentFiles(filePath: string): string[] {
  const parsed = path.parse(filePath);
  const sessionStem = parsed.name; // UUID without .jsonl
  const sessionDir = parsed.dir;
  const subagentsDir = path.join(sessionDir, sessionStem, "subagents");

  try {
    const stat = fs.statSync(subagentsDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = fs.readdirSync(subagentsDir).sort();
  return entries
    .filter((e) => e.startsWith("agent-") && e.endsWith(".jsonl"))
    .map((e) => path.join(subagentsDir, e));
}

/**
 * Full extraction pipeline for a session JSONL file.
 *
 * Validates the file is a main session, then extracts all signals.
 * Returns null if the file is not a main session.
 */
export function extractSession(filePath: string): SessionExtraction | null {
  if (!isMainSession(filePath)) return null;

  const records = parseJsonl(filePath);

  return {
    metadata: extractMetadata(records),
    conversation: extractConversation(records),
    skills: extractSkills(records),
    subagents: extractSubagents(records),
    tool_failures: extractToolFailures(records),
    tool_usage_summary: extractToolUsageSummary(records),
    api_errors: extractApiErrors(records),
    compactions: extractCompactions(records),
    subagent_files: findSubagentFiles(filePath),
    emotion_markers: extractEmotionMarkers(records),
  };
}

/**
 * Extract condensed data from a subagent JSONL file.
 * Same extraction as main session but skips the is_main_session check.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function extractSubsession(
  filePath: string
): SubsessionExtraction | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const records = parseJsonl(filePath);
  if (records.length === 0) return null;

  return {
    metadata: extractMetadata(records),
    conversation: extractConversation(records),
    skills: extractSkills(records),
    subagents: extractSubagents(records),
    tool_failures: extractToolFailures(records),
    tool_usage_summary: extractToolUsageSummary(records),
    api_errors: extractApiErrors(records),
    compactions: extractCompactions(records),
    emotion_markers: extractEmotionMarkers(records),
  };
}
