/**
 * Analyze command: runs LLM analysis on session transcripts to extract findings.
 *
 * For each session, extracts condensed data, sends to LLM for analysis,
 * and logs each finding via executeLog.
 */

import { loadConfig } from "../config.js";
import { searchSessions } from "../sessions/search.js";
import { extractSession } from "../sessions/extract.js";
import { callLLM } from "../llm.js";
import { executeLog } from "./log.js";
import { buildAnalyzePrompt } from "../prompts/analyze.js";
import type { FindingCategory, Priority } from "../types.js";

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

interface AnalyzeResponse {
  findings: AnalyzeFinding[];
}

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
    latest: options.latest ?? 5,
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

  let totalFindings = 0;
  let sessionsAnalyzed = 0;

  for (const session of targetSessions) {
    const extraction = extractSession(session.path);
    if (!extraction) {
      console.log(`Skipping ${session.session_id} (not a main session)`);
      continue;
    }

    const condensedJson = JSON.stringify(extraction);
    const prompt = buildAnalyzePrompt(condensedJson);

    let response: AnalyzeResponse;
    try {
      const llmResult = await callLLM<AnalyzeResponse>(
        config,
        prompt.system,
        prompt.user
      );
      response = llmResult.result;
    } catch (err) {
      console.error(
        `Error analyzing ${session.session_id}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    if (!response.findings || !Array.isArray(response.findings)) {
      console.log(`No findings for ${session.session_id}`);
      continue;
    }

    for (const finding of response.findings) {
      const category = VALID_CATEGORIES.has(finding.category)
        ? (finding.category as FindingCategory)
        : "best_practice";
      const priority = VALID_PRIORITIES.has(finding.priority)
        ? (finding.priority as Priority)
        : "medium";

      executeLog({
        category,
        summary: finding.summary,
        details: finding.details || "",
        priority,
        project: extraction.metadata.slug ?? "",
        projectPath: extraction.metadata.cwd ?? "",
        session: session.session_id,
        source: "analyze",
        tags: Array.isArray(finding.tags) ? finding.tags.join(", ") : "",
      });

      totalFindings++;
    }

    sessionsAnalyzed++;
    console.log(
      `Analyzed ${session.session_id}: ${response.findings.length} finding(s)`
    );
  }

  console.log(
    `\nDone. Analyzed ${sessionsAnalyzed} session(s), logged ${totalFindings} finding(s).`
  );
}
