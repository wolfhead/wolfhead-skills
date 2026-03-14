/**
 * Analyze command: runs LLM analysis on session transcripts to extract insights.
 *
 * For each session, extracts condensed data, sends to LLM for analysis,
 * and logs each insight via executeLog. Large sessions are split into
 * chunks at human_message boundaries and analyzed in a loop.
 */

import fs from "fs";
import { loadConfig, type SivConfig } from "../config.js";
import { searchSessions } from "../sessions/search.js";
import {
  extractSession,
  type SessionExtraction,
  type ConversationTurn,
} from "../sessions/extract.js";
import { callLLM } from "../llm.js";
import { executeLog } from "./log.js";
import { appendJsonl, readJsonl } from "../storage.js";
import { buildAnalyzePrompt } from "../prompts/analyze.js";
import type { InsightCategory, Priority } from "../types.js";

export interface AnalyzeOptions {
  latest?: number;
  projectPath?: string;
  since?: string;
  session?: string;
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
  scanned_at: string;
  file_modified: string;
  file_size_bytes: number;
  line_count: number;
  project: string;
  project_path: string;
  insights_count: number;
  chunks?: number;
  status: "ok" | "error" | "skipped";
  error?: string;
}

const MIN_NEW_LINES = 3;
const MIN_SESSION_LINES = 20;
const MAX_CHUNK_SIZE = 100_000; // chars of JSON per chunk

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

  const sessions = searchSessions({
    latest: options.latest,
    projectPath: options.projectPath,
    since: options.since,
    minTurns: 1,
  });

  // If --session is given, filter to that specific session
  const targetSessions = options.session
    ? sessions.filter((s) => s.session_id === options.session)
    : sessions;

  if (targetSessions.length === 0) {
    console.log("No sessions found matching criteria.");
    return;
  }

  // Skip sessions already scanned with same file_modified time
  const existingScans = readJsonl<ScanRecord>(config.scansPath);
  const scannedSessions = new Map<string, ScanRecord>();
  for (const scan of existingScans) {
    scannedSessions.set(scan.session_id, scan);
  }

  const newSessions = targetSessions.filter((s) => {
    const prev = scannedSessions.get(s.session_id);
    if (!prev) return true;
    if (prev.file_modified === s.modified) return false;
    const currentLines = countLines(s.path);
    return currentLines - prev.line_count >= MIN_NEW_LINES;
  });

  if (newSessions.length < targetSessions.length) {
    const skipped = targetSessions.length - newSessions.length;
    console.log(`Skipping ${skipped} already-scanned session(s).`);
  }

  if (newSessions.length === 0) {
    console.log("No new sessions to analyze.");
    return;
  }

  let totalInsights = 0;
  let sessionsAnalyzed = 0;

  for (const session of newSessions) {
    const lines = countLines(session.path);
    if (lines < MIN_SESSION_LINES) {
      logScan(config, {
        session_id: session.session_id,
        file_modified: session.modified,
        file_size_bytes: session.size_bytes,
        line_count: lines,
        project: "",
        project_path: "",
        insights_count: 0,
        status: "skipped",
        error: `too short (${lines} lines)`,
      });
      console.log(`Skipping ${session.session_id} (${lines} lines, min ${MIN_SESSION_LINES})`);
      continue;
    }

    const extraction = extractSession(session.path);
    if (!extraction) {
      logScan(config, {
        session_id: session.session_id,
        file_modified: session.modified,
        file_size_bytes: session.size_bytes,
        line_count: countLines(session.path),
        project: "",
        project_path: "",
        insights_count: 0,
        status: "skipped",
        error: "not a main session",
      });
      console.log(`Skipping ${session.session_id} (not a main session)`);
      continue;
    }

    const project = extraction.metadata.slug ?? "";
    const projectPath = extraction.metadata.cwd ?? "";

    try {
      const insights = await analyzeExtraction(config, extraction);

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
          session: session.session_id,
          source: "analyze",
          tags: Array.isArray(insight.tags) ? insight.tags.join(", ") : "",
        });

        totalInsights++;
      }

      const chunks = chunkConversation(extraction).length;
      logScan(config, {
        session_id: session.session_id,
        file_modified: session.modified,
        file_size_bytes: session.size_bytes,
        line_count: countLines(session.path),
        project,
        project_path: projectPath,
        insights_count: insights.length,
        chunks: chunks > 1 ? chunks : undefined,
        status: "ok",
      });

      sessionsAnalyzed++;
      const chunkNote = chunks > 1 ? ` (${chunks} chunks)` : "";
      console.log(
        `Analyzed ${session.session_id}: ${insights.length} insight(s)${chunkNote}`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logScan(config, {
        session_id: session.session_id,
        file_modified: session.modified,
        file_size_bytes: session.size_bytes,
        line_count: countLines(session.path),
        project,
        project_path: projectPath,
        insights_count: 0,
        status: "error",
        error: errMsg,
      });
      console.error(`Error analyzing ${session.session_id}: ${errMsg}`);
    }
  }

  console.log(
    `\nDone. Analyzed ${sessionsAnalyzed} session(s), logged ${totalInsights} insight(s).`
  );
}

/**
 * Analyze a session extraction. If the JSON is small enough, sends it
 * in one LLM call. Otherwise splits conversation at human_message
 * boundaries and processes each chunk in a loop.
 */
async function analyzeExtraction(
  config: SivConfig,
  extraction: SessionExtraction
): Promise<AnalyzeInsight[]> {
  const fullJson = JSON.stringify(extraction);

  // Small enough for one call
  if (fullJson.length <= MAX_CHUNK_SIZE) {
    return await callAnalyze(config, fullJson);
  }

  // Split into chunks
  const chunks = chunkConversation(extraction);
  const allInsights: AnalyzeInsight[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkExtraction: SessionExtraction = {
      ...extraction,
      conversation: chunks[i],
      // Only include signals in first chunk to avoid duplication
      tool_failures: i === 0 ? extraction.tool_failures : [],
      api_errors: i === 0 ? extraction.api_errors : [],
      skills: i === 0 ? extraction.skills : [],
      subagents: i === 0 ? extraction.subagents : [],
    };

    const chunkJson = JSON.stringify(chunkExtraction);
    const insights = await callAnalyze(config, chunkJson);
    allInsights.push(...insights);
  }

  return allInsights;
}

async function callAnalyze(
  config: SivConfig,
  condensedJson: string
): Promise<AnalyzeInsight[]> {
  const prompt = buildAnalyzePrompt(condensedJson);
  const llmResult = await callLLM<AnalyzeResponse>(
    config,
    prompt.system,
    prompt.user
  );

  const response = llmResult.result;
  if (!response.insights || !Array.isArray(response.insights)) {
    return [];
  }
  return response.insights;
}

/**
 * Split conversation turns into chunks at human_message boundaries.
 * Each chunk stays under MAX_CHUNK_SIZE when serialized.
 */
function chunkConversation(
  extraction: SessionExtraction
): ConversationTurn[][] {
  const turns = extraction.conversation;
  if (turns.length === 0) return [[]];

  // Find indices of human_message turns (natural split points)
  const humanIndices: number[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].type === "human_message") {
      humanIndices.push(i);
    }
  }

  // If no human messages, return as single chunk
  if (humanIndices.length === 0) return [turns];

  // Build chunks: group consecutive human_message segments together
  // until adding the next segment would exceed the size limit
  const chunks: ConversationTurn[][] = [];
  let currentChunk: ConversationTurn[] = [];

  for (let i = 0; i < humanIndices.length; i++) {
    const start = humanIndices[i];
    const end = i + 1 < humanIndices.length ? humanIndices[i + 1] : turns.length;
    const segment = turns.slice(start, end);

    // Check if adding this segment exceeds the limit
    const testChunk = [...currentChunk, ...segment];
    const testSize = JSON.stringify({
      ...extraction,
      conversation: testChunk,
    }).length;

    if (currentChunk.length > 0 && testSize > MAX_CHUNK_SIZE) {
      // Save current chunk, start new one with this segment
      chunks.push(currentChunk);
      currentChunk = segment;
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
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
