/**
 * Extract command: outputs parsed session data as JSON to stdout.
 * No LLM calls, no writes to ~/.siv/.
 */

import { searchSessions, type SearchOptions } from "../sessions/search.js";
import {
  extractSession,
  type SessionExtraction,
  type ConversationTurn,
} from "../sessions/extract.js";

const SUMMARY_TEXT_MAX_CHARS = 200;

export interface ExtractOptions {
  latest?: number;
  projectPath?: string;
  since?: string;
  session?: string;
  summary?: boolean;
}

/**
 * In summary mode, replace full conversation with just human messages (truncated).
 * Assistant turns, tool results, etc. are dropped — their signals are already
 * captured in tool_usage_summary, skills, tool_failures, and emotion_markers.
 */
function summarizeConversation(conversation: ConversationTurn[]): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  for (const turn of conversation) {
    if (turn.type === "human_message") {
      const text = turn.text.length > SUMMARY_TEXT_MAX_CHARS
        ? turn.text.slice(0, SUMMARY_TEXT_MAX_CHARS) + "…"
        : turn.text;
      result.push({ type: "human_message", text });
    }
    // Drop assistant_turn, tool_result, skill_loaded, tool_results_summary
  }
  return result;
}

export function executeExtract(options: ExtractOptions): void {
  const searchOpts: SearchOptions = {
    latest: options.latest,
    projectPath: options.projectPath,
    since: options.since,
    minTurns: 1,
  };

  const sessions = searchSessions(searchOpts);

  // If --session is given, filter to that specific session
  const targets = options.session
    ? sessions.filter((s) => s.session_id === options.session)
    : sessions;

  if (targets.length === 0) {
    console.error("No sessions found matching criteria.");
    return;
  }

  const results: SessionExtraction[] = [];
  let skipped = 0;

  for (const session of targets) {
    const extraction = extractSession(session.path);
    if (!extraction) {
      skipped++;
      continue;
    }
    if (options.summary) {
      extraction.conversation = summarizeConversation(extraction.conversation);
    }
    results.push(extraction);
  }

  if (skipped > 0) {
    console.error(`Skipped ${skipped} non-main session(s).`);
  }

  // Compact JSON when in summary mode (optimized for LLM context consumption)
  // Pretty JSON otherwise (human-readable for debugging)
  const indent = options.summary ? undefined : 2;
  console.log(JSON.stringify(results, null, indent));
}
