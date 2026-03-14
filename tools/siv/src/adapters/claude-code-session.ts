import type { SourceAdapter, ScanOptions, ScanCandidate, ExtractedSession } from "./types.js";
import { searchSessions } from "../sessions/search.js";
import { extractSession } from "../sessions/extract.js";

export class ClaudeCodeSessionAdapter implements SourceAdapter {
  name = "claude-code-session";

  async scan(options: ScanOptions): Promise<ScanCandidate[]> {
    const sessions = searchSessions({
      latest: options.latest,
      projectPath: options.projectPath,
      since: options.since,
      minTurns: 1,
      homeDir: options.homeDir,
    });
    return sessions.map((s) => ({
      id: s.session_id,
      source: this.name,
      metadata: {
        path: s.path,
        modified: s.modified,
        size_bytes: s.size_bytes,
        turn_count: s.turn_count,
      },
    }));
  }

  async extract(candidate: ScanCandidate): Promise<ExtractedSession> {
    const filePath = candidate.metadata.path as string;
    const extraction = extractSession(filePath);
    if (!extraction) {
      throw new Error(`Failed to extract session: ${candidate.id} (not a main session)`);
    }
    return {
      id: candidate.id,
      source: this.name,
      project: extraction.metadata.slug ?? undefined,
      project_path: extraction.metadata.cwd ?? undefined,
      condensed: JSON.stringify(extraction),
      metadata: {
        ...candidate.metadata,
        model: extraction.metadata.model,
        turn_count: extraction.metadata.turn_count,
      },
    };
  }
}
