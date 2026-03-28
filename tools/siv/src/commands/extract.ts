/**
 * Extract command: outputs parsed session data as JSON to stdout.
 * No LLM calls, no writes to ~/.siv/.
 */

import { searchSessions, type SearchOptions } from "../sessions/search.js";
import { extractSession, type SessionExtraction } from "../sessions/extract.js";

export interface ExtractOptions {
  latest?: number;
  projectPath?: string;
  since?: string;
  session?: string;
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
    results.push(extraction);
  }

  if (skipped > 0) {
    console.error(`Skipped ${skipped} non-main session(s).`);
  }

  console.log(JSON.stringify(results, null, 2));
}
