/**
 * Build the analysis prompt for LLM-based session analysis.
 *
 * The system prompt instructs the LLM to analyze a condensed session
 * transcript and return structured findings as JSON.
 */

export function buildAnalyzePrompt(condensedJson: string): {
  system: string;
  user: string;
} {
  const system = `You are an expert code review analyst. Your job is to analyze Claude Code session transcripts and identify actionable learnings.

Analyze the session transcript and return findings as a JSON object.

## What to look for

- **User corrections**: The user explicitly corrected the agent's approach, tool choice, or output
- **Wrong tool usage**: Using sed/awk instead of Edit, cat/head/tail instead of Read, grep instead of Grep, echo instead of Write
- **Unnecessary subagent spawns**: Agent/Task tool used for work that could have been done inline
- **Tool failures**: Repeated failures on the same tool, especially if the agent retried without changing approach
- **Doom loops**: The agent repeated the same failing action multiple times without adapting
- **Knowledge gaps**: The agent lacked knowledge about a framework, API, or codebase pattern that the user had to supply

## What NOT to report

- Normal, successful tool usage
- Style preferences that weren't explicitly corrected
- Obvious observations (e.g., "the session used TypeScript")
- Successful completions without issues

## Return format

Return a JSON object with this exact structure:
{
  "findings": [
    {
      "category": "<correction|error|knowledge_gap|best_practice|feature_request>",
      "summary": "<one-line summary of the finding>",
      "details": "<2-3 sentence explanation with specific context>",
      "priority": "<low|medium|high|critical>",
      "tags": ["<relevant>", "<tags>"]
    }
  ]
}

Priority guidelines:
- **critical**: Data loss risk, security issue, or repeated costly mistakes
- **high**: User had to intervene to correct a significant wrong direction
- **medium**: Suboptimal tool choice or approach that wasted time
- **low**: Minor inefficiency or style preference

If there are no findings, return: { "findings": [] }`;

  const user = `Analyze this session transcript:\n\n${condensedJson}`;

  return { system, user };
}
