# Wolfhead Skills

A collection of Claude Code skills and the `siv` CLI tool for automated session analysis and self-improvement.

## Good Coding Style and Taste

### General

- Write simple, direct code. Prefer clarity over cleverness.
- No over-engineering: solve the current problem, not hypothetical future ones.
- Three similar lines > premature abstraction. Extract only when there's a clear third use.
- Delete dead code. No commented-out blocks, no `_unused` renames, no backwards-compat shims.
- Constants must be justified. No magic numbers — add a brief comment explaining why.

### TypeScript (tools/siv/)

- Use explicit types for function signatures and interfaces. Let inference handle locals.
- Prefer `interface` over `type` for object shapes.
- Handle errors explicitly with helpful messages — don't let exceptions bubble silently.
- Use `path.join()` for file paths, never string concatenation.
- Import order: node builtins → third-party → local modules (no blank lines between groups).

### Python (skills/*/scripts/)

- Scripts should solve problems, not punt to Claude. Handle error conditions explicitly.
- Use `argparse` for CLI scripts with clear `--help` text.
- Print structured output (JSON) for machine consumption, human-readable messages to stderr.

### Commit Messages

- Format: `type(scope): description` (e.g., `feat(siv): add doctor command`)
- Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`
- Keep subject line under 72 characters. Focus on why, not what.

## Skill and Prompt Writing Guide

### Quick Reference

| Topic | Reference |
|-------|-----------|
| Skill structure, SKILL.md format, bundled resources, testing | [docs/skill-design-best-practices.md](docs/skill-design-best-practices.md) |
| Prompt engineering techniques, anti-patterns, model-specific tips | [docs/llm-prompt-engineering-best-practices.md](docs/llm-prompt-engineering-best-practices.md) |

### Key Principles (from reference docs)

**Skill design:**
- SKILL.md body under 500 lines. Use progressive disclosure — put details in `references/`.
- Description field starts with "Use when...", written in third person. Never summarize the workflow in the description.
- Constraints go at the top in `<HARD-GATE>` blocks. Use FORBIDDEN/MUST, not suggestions.
- Include pre-action checklists before irreversible actions.
- Provide correct + incorrect examples for constraint-heavy skills.
- Test skills with pressure scenarios before shipping.

**Prompt writing:**
- Be specific: specify format, length, tone, and constraints explicitly.
- Use XML tags for structure (Claude responds well to `<instructions>`, `<example>`, etc.).
- Few-shot examples are the highest-ROI technique — use them when format matters.
- Don't use explicit CoT with reasoning models (extended thinking, o1).
- Keep task prompts to 150-300 words. Performance degrades past ~3,000 tokens of instructions.
- Place long documents first, questions/tasks last.
