/**
 * Analyze command: runs LLM analysis on session transcripts to extract insights.
 *
 * For each session, extracts condensed data, sends to LLM for analysis,
 * and logs each insight via executeLog. Large sessions are split into
 * chunks at human_message boundaries and analyzed in a loop.
 */

import fs from "fs";
import { loadConfig, type SivConfig } from "../config.js";
import {
  extractSession,
  type SessionExtraction,
  type EmotionMarker,
} from "../sessions/extract.js";
import { callLLM } from "../llm.js";
import { executeLog } from "./log.js";
import { appendJsonl, readJsonl } from "../storage.js";
import { buildMarkerAnalyzePrompt } from "../prompts/analyze.js";
import type { InsightCategory, Priority } from "../types.js";
import { ClaudeCodeSessionAdapter } from "../adapters/claude-code-session.js";
import type { SourceAdapter, ScanCandidate } from "../adapters/types.js";

export interface AnalyzeOptions {
  latest?: number;
  projectPath?: string;
  since?: string;
  session?: string;
  source?: string;
}

interface AnalyzeInsight {
  category: string;
  summary: string;
  details: string;
  priority: string;
  tags: string[];
}

interface AnalyzeResponse {
  insights: AnalyzeInsight[];
}

interface ScanRecord {
  session_id: string;
  source: string;
  scanned_at: string;
  file_modified: string;
  file_size_bytes: number;
  line_count: number;
  project: string;
  project_path: string;
  insights_count: number;
  status: "ok" | "error" | "skipped";
  error?: string;
}

function getAdapter(sourceName: string): SourceAdapter {
  switch (sourceName) {
    case "claude-code-session":
      return new ClaudeCodeSessionAdapter();
    default:
      throw new Error(`Unknown source adapter: ${sourceName}`);
  }
}

const MIN_NEW_LINES = 3;
const MIN_SESSION_LINES = 20;

const VALID_CATEGORIES: Set<string> = new Set([
  "correction",
  "error",
  "knowledge_gap",
  "best_practice",
  "feature_request",
]);

const VALID_PRIORITIES: Set<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);

export async function executeAnalyze(options: AnalyzeOptions): Promise<void> {
  const config = loadConfig();
  const adapter = getAdapter(options.source ?? "claude-code-session");

  const candidates = await adapter.scan({
    latest: options.latest,
    projectPath: options.projectPath,
    since: options.since,
  });

  // If --session is given, filter to that specific session
  const targetCandidates = options.session
    ? candidates.filter((c) => c.id === options.session)
    : candidates;

  if (targetCandidates.length === 0) {
    console.log("No sessions found matching criteria.");
    return;
  }

  // Skip sessions already scanned with same file_modified time
  const existingScans = readJsonl<ScanRecord>(config.scansPath);
  const scannedSessions = new Map<string, ScanRecord>();
  for (const scan of existingScans) {
    scannedSessions.set(scan.session_id, scan);
  }

  const newCandidates = targetCandidates.filter((c) => {
    const prev = scannedSessions.get(c.id);
    if (!prev) return true;
    if (prev.file_modified === (c.metadata.modified as string)) return false;
    const currentLines = countLines(c.metadata.path as string);
    return currentLines - prev.line_count >= MIN_NEW_LINES;
  });

  if (newCandidates.length < targetCandidates.length) {
    const skipped = targetCandidates.length - newCandidates.length;
    console.log(`Skipping ${skipped} already-scanned session(s).`);
  }

  if (newCandidates.length === 0) {
    console.log("No new sessions to analyze.");
    return;
  }

  let totalInsights = 0;
  let sessionsAnalyzed = 0;

  for (const candidate of newCandidates) {
    const filePath = candidate.metadata.path as string;
    const modified = candidate.metadata.modified as string;
    const sizeBytes = candidate.metadata.size_bytes as number;

    const lines = countLines(filePath);
    if (lines < MIN_SESSION_LINES) {
      logScan(config, {
        session_id: candidate.id,
        source: adapter.name,
        file_modified: modified,
        file_size_bytes: sizeBytes,
        line_count: lines,
        project: "",
        project_path: "",
        insights_count: 0,
        status: "skipped",
        error: `too short (${lines} lines)`,
      });
      console.log(`Skipping ${candidate.id} (${lines} lines, min ${MIN_SESSION_LINES})`);
      continue;
    }

    const extraction = extractSession(filePath);
    if (!extraction) {
      logScan(config, {
        session_id: candidate.id,
        source: adapter.name,
        file_modified: modified,
        file_size_bytes: sizeBytes,
        line_count: countLines(filePath),
        project: "",
        project_path: "",
        insights_count: 0,
        status: "skipped",
        error: "not a main session",
      });
      console.log(`Skipping ${candidate.id} (not a main session)`);
      continue;
    }

    const project = extraction.metadata.slug ?? "";
    const projectPath = extraction.metadata.cwd ?? "";

    try {
      const markers = extraction.emotion_markers;

      if (markers.length === 0) {
        logScan(config, {
          session_id: candidate.id,
          source: adapter.name,
          file_modified: modified,
          file_size_bytes: sizeBytes,
          line_count: countLines(filePath),
          project,
          project_path: projectPath,
          insights_count: 0,
          status: "skipped",
          error: "no markers",
        });
        console.log(`Skipping ${candidate.id} (no markers)`);
        continue;
      }

      const contextWindows = buildContextWindows(extraction, markers);
      const insights = await callMarkerAnalyze(config, markers, contextWindows);

      for (const insight of insights) {
        const category = VALID_CATEGORIES.has(insight.category)
          ? (insight.category as InsightCategory)
          : "best_practice";
        const priority = VALID_PRIORITIES.has(insight.priority)
          ? (insight.priority as Priority)
          : "medium";

        executeLog({
          category,
          summary: insight.summary,
          details: insight.details || "",
          priority,
          project,
          projectPath,
          session: candidate.id,
          source: "analyze",
          tags: Array.isArray(insight.tags) ? insight.tags.join(", ") : "",
        });

        totalInsights++;
      }

      logScan(config, {
        session_id: candidate.id,
        source: adapter.name,
        file_modified: modified,
        file_size_bytes: sizeBytes,
        line_count: countLines(filePath),
        project,
        project_path: projectPath,
        insights_count: insights.length,
        status: "ok",
      });

      sessionsAnalyzed++;
      console.log(
        `Analyzed ${candidate.id}: ${insights.length} insight(s)`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logScan(config, {
        session_id: candidate.id,
        source: adapter.name,
        file_modified: modified,
        file_size_bytes: sizeBytes,
        line_count: countLines(filePath),
        project,
        project_path: projectPath,
        insights_count: 0,
        status: "error",
        error: errMsg,
      });
      console.error(`Error analyzing ${candidate.id}: ${errMsg}`);
    }
  }

  console.log(
    `\nDone. Analyzed ${sessionsAnalyzed} session(s), logged ${totalInsights} insight(s).`
  );
}

/**
 * Deduplicate markers of same type within 3 human turns.
 * Keeps first marker in each cluster.
 */
function deduplicateMarkers(markers: EmotionMarker[]): EmotionMarker[] {
  const sorted = [...markers].sort((a, b) => a.turn_index - b.turn_index);
  const result: EmotionMarker[] = [];
  const lastKept = new Map<string, number>();

  for (const m of sorted) {
    const prev = lastKept.get(m.type);
    if (prev !== undefined && m.turn_index - prev <= 3) continue;
    result.push(m);
    lastKept.set(m.type, m.turn_index);
  }
  return result;
}

/**
 * Merge overlapping or adjacent windows.
 */
function mergeWindows(
  windows: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

/**
 * Build context windows around emotion markers.
 * Per spec: 5 human turns before + 2 human turns after each marker.
 */
function buildContextWindows(
  extraction: SessionExtraction,
  markers: EmotionMarker[]
): string {
  const conversation = extraction.conversation;
  const humanTurnPositions: number[] = [];
  for (let i = 0; i < conversation.length; i++) {
    if (conversation[i].type === "human_message") {
      humanTurnPositions.push(i);
    }
  }

  const deduped = deduplicateMarkers(markers);
  const windows: Array<{ start: number; end: number }> = [];

  for (const marker of deduped) {
    const humanIdx = Math.min(
      marker.turn_index,
      humanTurnPositions.length - 1
    );
    const startHumanIdx = Math.max(0, humanIdx - 5);
    const endHumanIdx = Math.min(
      humanTurnPositions.length - 1,
      humanIdx + 2
    );
    windows.push({
      start: humanTurnPositions[startHumanIdx],
      end:
        endHumanIdx + 1 < humanTurnPositions.length
          ? humanTurnPositions[endHumanIdx + 1]
          : conversation.length,
    });
  }

  const merged = mergeWindows(windows);
  return merged
    .map((w) => JSON.stringify(conversation.slice(w.start, w.end)))
    .join("\n\n---\n\n");
}

async function callMarkerAnalyze(
  config: SivConfig,
  markers: EmotionMarker[],
  contextWindows: string
): Promise<AnalyzeInsight[]> {
  const prompt = buildMarkerAnalyzePrompt(markers, contextWindows);
  const llmResult = await callLLM<AnalyzeResponse>(
    config,
    prompt.system,
    prompt.user
  );
  if (!llmResult.result.insights || !Array.isArray(llmResult.result.insights)) {
    return [];
  }
  return llmResult.result.insights;
}

function logScan(
  config: SivConfig,
  record: Omit<ScanRecord, "scanned_at">
): void {
  appendJsonl(config.scansPath, {
    scanned_at: new Date().toISOString(),
    ...record,
  } as unknown as Record<string, unknown>);
}

function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}
