/**
 * Mark command: record an emotion marker.
 * Nearly a no-op — prints "marked" and exits. Its purpose is to leave
 * a trace in the session record (Claude Code logs all tool calls).
 * No file I/O, no network calls, no side effects.
 */
export function executeMark(type: string, context?: string): string {
  return "marked";
}
