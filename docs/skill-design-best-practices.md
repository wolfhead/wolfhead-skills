# Skill Design Best Practices

Comprehensive reference compiled from Anthropic's official skill authoring guide, the skill-creator skill, the writing-skills superpowers skill, and their supporting references.

---

## 1. Skill Anatomy and Structure

### What Skills Are

Skills are modular, self-contained packages that extend Claude's capabilities by providing specialized knowledge, workflows, and tools. They act as "onboarding guides" for specific domains or tasks, transforming Claude from a general-purpose agent into a specialized agent equipped with procedural knowledge that no model can fully possess.

### What Skills Provide

1. **Specialized workflows** - Multi-step procedures for specific domains
2. **Tool integrations** - Instructions for working with specific file formats or APIs
3. **Domain expertise** - Company-specific knowledge, schemas, business logic
4. **Bundled resources** - Scripts, references, and assets for complex and repetitive tasks

### Skill Types

| Type | Description | Examples |
|------|-------------|----------|
| **Technique** | Concrete method with steps to follow | condition-based-waiting, root-cause-tracing |
| **Pattern** | Way of thinking about problems | flatten-with-flags, test-invariants |
| **Reference** | API docs, syntax guides, tool documentation | office docs, library guides |

### Directory Structure

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code (Python/Bash/etc.)
    ├── references/       - Documentation loaded into context as needed
    └── assets/           - Files used in output (templates, icons, fonts, etc.)
```

### What NOT to Include

Do NOT create extraneous documentation or auxiliary files:
- README.md
- INSTALLATION_GUIDE.md
- QUICK_REFERENCE.md
- CHANGELOG.md

The skill should only contain the information needed for an AI agent to do the job at hand. No auxiliary context about the creation process, setup/testing procedures, or user-facing documentation.

---

## 2. SKILL.md Writing Guidelines

### Frontmatter (YAML)

Only two required fields are supported: `name` and `description`. Additional allowed fields: `license`, `allowed-tools`, `metadata`.

#### Name Field

- **Format**: Hyphen-case (lowercase letters, digits, and hyphens only)
- **Maximum**: 64 characters
- Cannot start/end with hyphen or contain consecutive hyphens
- Use active voice, verb-first naming:
  - `creating-skills` not `skill-creation`
  - `condition-based-waiting` not `async-test-helpers`
- Gerunds (-ing) work well for processes: `creating-skills`, `testing-skills`, `debugging-with-logs`
- Name by what you DO or core insight, not vague categories

**Naming conventions (good examples)**:
- "Processing PDFs"
- "Analyzing spreadsheets"
- "Managing databases"

**Avoid**:
- Vague names: "Helper", "Utils", "Tools"
- Overly generic: "Documents", "Data", "Files"

#### Description Field

This is the **primary triggering mechanism** for the skill. Claude reads descriptions to decide which skills to load for a given task.

**Critical rules:**
- **Maximum**: 1024 characters (aim for under 500)
- **Always write in third person** (injected into system prompt)
- **Start with "Use when..."** to focus on triggering conditions
- Include both what the Skill does AND specific triggers/contexts for when to use it
- Include ALL "when to use" information here, not in the body
- **NEVER summarize the skill's process or workflow** in the description

**Why no workflow summary**: Testing revealed that when a description summarizes the skill's workflow, Claude may follow the description instead of reading the full skill content. A description saying "code review between tasks" caused Claude to do ONE review, even though the skill's flowchart showed TWO reviews. When the description was changed to just triggering conditions (no workflow summary), Claude correctly read and followed the full process.

**Content guidelines:**
- Use concrete triggers, symptoms, and situations
- Describe the *problem* (race conditions, inconsistent behavior) not *language-specific symptoms* (setTimeout, sleep)
- Keep triggers technology-agnostic unless the skill itself is technology-specific
- Include keyword coverage: error messages, symptoms, synonyms, tool names

```yaml
# BAD: Summarizes workflow - Claude may follow this instead of reading skill
description: Use when executing plans - dispatches subagent per task with code review between tasks

# BAD: Too abstract, vague, doesn't include when to use
description: For async testing

# BAD: First person
description: I can help you with async tests when they're flaky

# GOOD: Just triggering conditions, no workflow summary
description: Use when executing implementation plans with independent tasks in the current session

# GOOD: Specific and comprehensive
description: Comprehensive document creation, editing, and analysis with support for tracked changes, comments, formatting preservation, and text extraction. Use when Claude needs to work with professional documents (.docx files) for creating new documents, modifying or editing content, working with tracked changes, adding comments, or any other document tasks
```

### Body (Markdown)

**Writing guidelines**: Always use imperative/infinitive form.

#### Recommended SKILL.md Body Structure

```markdown
# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## When to Use
[Small inline flowchart IF decision non-obvious]
Bullet list with SYMPTOMS and use cases
When NOT to use

## Core Pattern (for techniques/patterns)
Before/after code comparison

## Quick Reference
Table or bullets for scanning common operations

## Implementation
Inline code for simple patterns
Link to file for heavy reference or reusable tools

## Common Mistakes
What goes wrong + fixes

## Real-World Impact (optional)
Concrete results
```

#### Token Budget Constraints

- Keep SKILL.md body **under 500 lines** for optimal performance
- Frequently-loaded skills: **under 200 words total**
- Getting-started workflows: **under 150 words each**
- Other skills: **under 500 words** (still be concise)
- Split content into separate files when approaching limits

---

## 3. Progressive Disclosure Design Principle

Skills use a three-level loading system to manage context efficiently:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - As needed by Claude (unlimited; scripts can be executed without reading into context)

### Progressive Disclosure Patterns

**Pattern 1: High-level guide with references**

```markdown
# PDF Processing

## Quick start
Extract text with pdfplumber:
[code example]

## Advanced features
- **Form filling**: See [FORMS.md](FORMS.md) for complete guide
- **API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
- **Examples**: See [EXAMPLES.md](EXAMPLES.md) for common patterns
```

Claude loads FORMS.md, REFERENCE.md, or EXAMPLES.md only when needed.

**Pattern 2: Domain-specific organization**

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── reference/
    ├── finance.md (revenue, billing metrics)
    ├── sales.md (opportunities, pipeline)
    ├── product.md (API usage, features)
    └── marketing.md (campaigns, attribution)
```

When a user asks about sales metrics, Claude only reads sales.md.

**Pattern 3: Conditional details**

```markdown
# DOCX Processing

## Creating documents
Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents
For simple edits, modify the XML directly.
**For tracked changes**: See [REDLINING.md](REDLINING.md)
**For OOXML details**: See [OOXML.md](OOXML.md)
```

### Critical Structural Rules

- **Avoid deeply nested references** - Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md.
- **Structure longer reference files** - For files longer than 100 lines, include a table of contents at the top so Claude can see the full scope when previewing.
- **Reference from SKILL.md** - When splitting out content into other files, reference them from SKILL.md and describe clearly when to read them.

---

## 4. Core Principles

### Concise is Key

The context window is a public good. Skills share it with system prompt, conversation history, other Skills' metadata, and the actual user request.

**Default assumption: Claude is already very smart.** Only add context Claude doesn't already have. Challenge each piece of information:
- "Does Claude really need this explanation?"
- "Can I assume Claude knows this?"
- "Does this paragraph justify its token cost?"

Prefer concise examples over verbose explanations.

**Good example** (~50 tokens):
```markdown
## Extract PDF text
Use pdfplumber for text extraction:
```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

**Bad example** (~150 tokens):
```markdown
## Extract PDF text
PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library. There are many libraries available for PDF processing, but we
recommend pdfplumber because it's easy to use...
```

### Token Efficiency Techniques

**Move details to tool help:**
```bash
# BAD: Document all flags in SKILL.md
search-conversations supports --text, --both, --after DATE, --before DATE, --limit N

# GOOD: Reference --help
search-conversations supports multiple modes and filters. Run --help for details.
```

**Use cross-references instead of repeating:**
```markdown
# BAD: Repeat workflow details
When searching, dispatch subagent with template...
[20 lines of repeated instructions]

# GOOD: Reference other skill
Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.
```

**Compress examples and eliminate redundancy:**
- Don't repeat what's in cross-referenced skills
- Don't explain what's obvious from a command
- Don't include multiple examples of the same pattern

### Set Appropriate Degrees of Freedom

Match the level of specificity to the task's fragility and variability:

| Level | When to Use | Example |
|-------|-------------|---------|
| **High freedom** (text instructions) | Multiple approaches valid, context-dependent | Code review process guidance |
| **Medium freedom** (pseudocode/scripts with params) | Preferred pattern exists, some variation OK | Report generation template |
| **Low freedom** (specific scripts, few params) | Fragile operations, consistency critical | Database migration commands |

Analogy: A narrow bridge with cliffs needs specific guardrails (low freedom), while an open field allows many routes (high freedom).

---

## 5. Bundled Resources

### Scripts (`scripts/`)

Executable code for tasks requiring deterministic reliability or that would be repeatedly rewritten.

**When to include**: When the same code is being rewritten repeatedly or deterministic reliability is needed.

**Benefits**:
- Token efficient (executed without loading into context)
- Deterministic results
- More reliable than generated code
- Ensure consistency across uses

**Script design principles:**
- **Solve, don't punt** - Handle error conditions rather than punting to Claude
- **No magic numbers** - All configuration values must be justified and documented
- **Explicit error handling** - Provide helpful error messages, not bare exceptions
- **Make execution intent clear** - Distinguish "Run script.py" (execute) from "See script.py" (read as reference)
- **Test scripts by running them** to ensure no bugs and expected output

```python
# GOOD: Handle errors explicitly
def process_file(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        print(f"File {path} not found, creating default")
        with open(path, 'w') as f:
            f.write('')
        return ''

# BAD: Punt to Claude
def process_file(path):
    return open(path).read()  # Just fails
```

```python
# GOOD: Self-documenting constants
REQUEST_TIMEOUT = 30  # HTTP requests typically complete within 30 seconds
MAX_RETRIES = 3       # Most intermittent failures resolve by second retry

# BAD: Magic numbers
TIMEOUT = 47  # Why 47?
RETRIES = 5   # Why 5?
```

### References (`references/`)

Documentation loaded as-needed into context to inform Claude's process and thinking.

**When to include**: Database schemas, API documentation, domain knowledge, company policies, detailed workflow guides.

**Best practices:**
- Keep SKILL.md lean; detailed information goes in references
- If files are large (>10k words), include grep search patterns in SKILL.md
- **Avoid duplication** - Information should live in either SKILL.md or references files, not both
- For files longer than 100 lines, include a table of contents at the top

### Assets (`assets/`)

Files not loaded into context, but used within the output Claude produces.

**When to include**: Templates, images, icons, boilerplate code, fonts, sample documents that get copied or modified.

**Examples**: `assets/logo.png`, `assets/slides.pptx`, `assets/frontend-template/`, `assets/font.ttf`

---

## 6. Workflow Patterns

### Sequential Workflows

For complex tasks, break operations into clear, sequential steps. Provide an overview of the process towards the beginning of SKILL.md:

```markdown
Filling a PDF form involves these steps:

1. Analyze the form (run analyze_form.py)
2. Create field mapping (edit fields.json)
3. Validate mapping (run validate_fields.py)
4. Fill the form (run fill_form.py)
5. Verify output (run verify_output.py)
```

For complex workflows, provide a **checklist** that Claude can copy and track:

```markdown
## PDF form filling workflow

Copy this checklist and check off items as you complete them:

Task Progress:
- [ ] Step 1: Analyze the form (run analyze_form.py)
- [ ] Step 2: Create field mapping (edit fields.json)
- [ ] Step 3: Validate mapping (run validate_fields.py)
- [ ] Step 4: Fill the form (run fill_form.py)
- [ ] Step 5: Verify output (run verify_output.py)
```

### Conditional Workflows

For tasks with branching logic, guide Claude through decision points:

```markdown
1. Determine the modification type:
   **Creating new content?** -> Follow "Creation workflow" below
   **Editing existing content?** -> Follow "Editing workflow" below

2. Creation workflow: [steps]
3. Editing workflow: [steps]
```

If workflows become large or complicated with many steps, push them into separate files and tell Claude to read the appropriate file based on the task at hand.

### Feedback Loops

Common pattern: Run validator -> fix errors -> repeat. This pattern greatly improves output quality.

```markdown
## Document editing process

1. Make your edits to `word/document.xml`
2. **Validate immediately**: `python ooxml/scripts/validate.py unpacked_dir/`
3. If validation fails:
   - Review the error message carefully
   - Fix the issues in the XML
   - Run validation again
4. **Only proceed when validation passes**
5. Rebuild: `python ooxml/scripts/pack.py unpacked_dir/ output.docx`
6. Test the output document
```

### Verifiable Intermediate Outputs

For complex, open-ended tasks, use the "plan-validate-execute" pattern:

1. Analyze -> **create plan file** (e.g., changes.json) -> **validate plan** -> execute -> verify

**Why this works:**
- Catches errors early with machine-verifiable validation
- Reversible planning (iterate on plan without touching originals)
- Clear debugging with specific error messages

**When to use**: Batch operations, destructive changes, complex validation rules, high-stakes operations.

**Implementation tip**: Make validation scripts verbose with specific error messages like "Field 'signature_date' not found. Available fields: customer_name, order_total, signature_date_signed."

---

## 7. Output Patterns

### Template Pattern

Provide templates for output format. Match strictness level to your needs.

**For strict requirements** (like API responses or data formats):

```markdown
## Report structure

ALWAYS use this exact template structure:

# [Analysis Title]

## Executive summary
[One-paragraph overview of key findings]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data

## Recommendations
1. Specific actionable recommendation
2. Specific actionable recommendation
```

**For flexible guidance** (when adaptation is useful):

```markdown
## Report structure

Here is a sensible default format, but use your best judgment:

# [Analysis Title]
## Executive summary
[Overview]
## Key findings
[Adapt sections based on what you discover]
## Recommendations
[Tailor to the specific context]

Adjust sections as needed for the specific analysis type.
```

### Examples Pattern

For skills where output quality depends on seeing examples, provide input/output pairs:

```markdown
## Commit message format

Generate commit messages following these examples:

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
feat(auth): implement JWT-based authentication
Add login endpoint and token validation middleware

**Example 2:**
Input: Fixed bug where dates displayed incorrectly in reports
Output:
fix(reports): correct date formatting in timezone conversion
Use UTC timestamps consistently across report generation
```

Examples help Claude understand the desired style and level of detail more clearly than descriptions alone.

**Code example guidelines:**
- One excellent example beats many mediocre ones
- Choose the most relevant language for the domain
- Make examples complete and runnable
- Well-commented explaining WHY, not just what
- From real scenarios, not contrived
- Ready to adapt (not generic template)
- Do NOT implement in 5+ languages

---

## 8. Claude Search Optimization (CSO)

### Rich Description Field

Claude reads descriptions to decide which skills to load. Make it answer: "Should I read this skill right now?"

### Keyword Coverage

Use words Claude would search for:
- Error messages: "Hook timed out", "ENOTEMPTY", "race condition"
- Symptoms: "flaky", "hanging", "zombie", "pollution"
- Synonyms: "timeout/hang/freeze", "cleanup/teardown/afterEach"
- Tools: Actual commands, library names, file types

### Cross-Referencing Other Skills

Use skill name only, with explicit requirement markers:
- GOOD: `**REQUIRED SUB-SKILL:** Use superpowers:test-driven-development`
- GOOD: `**REQUIRED BACKGROUND:** You MUST understand superpowers:systematic-debugging`
- BAD: `See skills/testing/test-driven-development` (unclear if required)
- BAD: `@skills/testing/test-driven-development/SKILL.md` (force-loads, burns context)

**Why no @ links:** `@` syntax force-loads files immediately, consuming 200k+ context before you need them.

---

## 9. Quality Standards and Anti-Patterns

### Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad |
|--------------|--------------|
| **Narrative examples** ("In session 2025-10-03, we found empty projectDir caused...") | Too specific, not reusable |
| **Multi-language dilution** (example-js.js, example-py.py, example-go.go) | Mediocre quality, maintenance burden |
| **Code in flowcharts** (graphviz labels with code) | Can't copy-paste, hard to read |
| **Generic labels** (helper1, helper2, step3, pattern4) | Labels should have semantic meaning |
| **Too many options** ("Use pypdf, or pdfplumber, or PyMuPDF, or...") | Confusing; provide a default with escape hatch |
| **Assuming tools installed** ("Use the pdf library") | Explicitly list dependencies |
| **Windows-style paths** (`scripts\helper.py`) | Use forward slashes always |
| **Time-sensitive information** ("If before August 2025, use old API") | Use "old patterns" sections instead |
| **Inconsistent terminology** (mixing "field", "box", "element", "control") | Choose one term and use throughout |
| **Deeply nested references** (SKILL.md -> advanced.md -> details.md) | Keep references one level deep |

### Flowchart Usage Guidelines

**Use flowcharts ONLY for:**
- Non-obvious decision points
- Process loops where you might stop too early
- "When to use A vs B" decisions

**Never use flowcharts for:**
- Reference material (use tables, lists)
- Code examples (use markdown blocks)
- Linear instructions (use numbered lists)
- Labels without semantic meaning

### Quality Checklist

**Core quality:**
- [ ] Description is specific and includes key terms
- [ ] Description includes both what the Skill does and when to use it
- [ ] Description starts with "Use when..." and is written in third person
- [ ] SKILL.md body is under 500 lines
- [ ] Additional details are in separate files (if needed)
- [ ] No time-sensitive information
- [ ] Consistent terminology throughout
- [ ] Examples are concrete, not abstract
- [ ] File references are one level deep
- [ ] Progressive disclosure used appropriately
- [ ] Workflows have clear steps

**Code and scripts:**
- [ ] Scripts solve problems rather than punt to Claude
- [ ] Error handling is explicit and helpful
- [ ] No magic constants (all values justified)
- [ ] Required packages listed and verified available
- [ ] Scripts have clear documentation
- [ ] No Windows-style paths
- [ ] Validation/verification steps for critical operations
- [ ] Feedback loops included for quality-critical tasks

**Testing:**
- [ ] At least three evaluations created
- [ ] Tested with real usage scenarios
- [ ] Team feedback incorporated (if applicable)

---

## 10. Testing and Validation

### Evaluation-Driven Development

Create evaluations BEFORE writing extensive documentation:

1. **Identify gaps**: Run Claude on representative tasks without a Skill. Document specific failures
2. **Create evaluations**: Build three scenarios that test these gaps
3. **Establish baseline**: Measure Claude's performance without the Skill
4. **Write minimal instructions**: Just enough to address the gaps
5. **Iterate**: Execute evaluations, compare against baseline, refine

### TDD for Skills (from writing-skills)

Writing skills IS Test-Driven Development applied to process documentation.

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (SKILL.md) |
| **Test fails (RED)** | Agent violates rule without skill (baseline) |
| **Test passes (GREEN)** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |

**The Iron Law: No skill without a failing test first.**

#### RED Phase: Write Failing Test (Baseline)

Run pressure scenario with subagent WITHOUT the skill. Document exact behavior:
- What choices did they make?
- What rationalizations did they use (verbatim)?
- Which pressures triggered violations?

#### GREEN Phase: Write Minimal Skill

Write skill that addresses those specific rationalizations. Don't add extra content for hypothetical cases. Run same scenarios WITH skill. Agent should now comply.

#### REFACTOR Phase: Close Loopholes

Agent found new rationalization? Add explicit counter. Re-test until bulletproof.

### Pressure Testing

Good pressure scenarios combine 3+ pressures:

| Pressure Type | Example |
|---------------|---------|
| **Time** | Emergency, deadline, deploy window closing |
| **Sunk cost** | Hours of work, "waste" to delete |
| **Authority** | Senior says skip it, manager overrides |
| **Economic** | Job, promotion, company survival at stake |
| **Exhaustion** | End of day, already tired, want to go home |
| **Social** | Looking dogmatic, seeming inflexible |
| **Pragmatic** | "Being pragmatic vs dogmatic" |

**Key elements of good pressure scenarios:**
1. Concrete options - Force A/B/C choice, not open-ended
2. Real constraints - Specific times, actual consequences
3. Real file paths - `/tmp/payment-system` not "a project"
4. Make agent act - "What do you do?" not "What should you do?"
5. No easy outs - Can't defer without choosing

### Testing Different Skill Types

| Skill Type | Test Approach | Success Criteria |
|------------|---------------|------------------|
| **Discipline-enforcing** (rules) | Pressure scenarios, combined pressures, rationalization identification | Agent follows rule under maximum pressure |
| **Technique** (how-to) | Application scenarios, variation/edge cases, missing information tests | Agent successfully applies technique to new scenario |
| **Pattern** (mental models) | Recognition scenarios, application, counter-examples | Agent correctly identifies when/how to apply |
| **Reference** (docs/APIs) | Retrieval scenarios, application, gap testing | Agent finds and correctly applies information |

---

## 11. Bulletproofing Discipline-Enforcing Skills

### Close Every Loophole Explicitly

Don't just state the rule -- forbid specific workarounds:

```markdown
# BAD
Write code before test? Delete it.

# GOOD
Write code before test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

### Address "Spirit vs Letter" Arguments

Add foundational principle early:

```markdown
**Violating the letter of the rules is violating the spirit of the rules.**
```

### Build Rationalization Table

Capture rationalizations from baseline testing. Every excuse agents make goes in the table:

```markdown
| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Keep as reference" | You'll adapt it. That's testing after. Delete means delete. |
```

### Create Red Flags List

Make it easy for agents to self-check:

```markdown
## Red Flags - STOP and Start Over

- Code before test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**
```

---

## 12. Persuasion Principles for Skill Design

LLMs respond to the same persuasion principles as humans (Meincke et al., 2025: N=28,000 conversations, compliance 33% -> 72%).

### Principle Application by Skill Type

| Skill Type | Use | Avoid |
|------------|-----|-------|
| Discipline-enforcing | Authority + Commitment + Social Proof | Liking, Reciprocity |
| Guidance/technique | Moderate Authority + Unity | Heavy authority |
| Collaborative | Unity + Commitment | Authority, Liking |
| Reference | Clarity only | All persuasion |

### Key Principles

**Authority**: Imperative language ("YOU MUST", "Never", "Always"), non-negotiable framing ("No exceptions"). Eliminates decision fatigue and rationalization. Use for discipline-enforcing skills and safety-critical practices.

**Commitment**: Require announcements ("Announce skill usage"), force explicit choices ("Choose A, B, or C"), use tracking (checklists). Use for multi-step processes and accountability.

**Scarcity**: Time-bound requirements ("Before proceeding"), sequential dependencies ("Immediately after X"). Use for immediate verification requirements.

**Social Proof**: Universal patterns ("Every time", "Always"), failure modes ("X without Y = failure"). Use for documenting universal practices and reinforcing standards.

**Unity**: Collaborative language ("our codebase", "we're colleagues"), shared goals. Use for collaborative workflows and non-hierarchical practices.

### Why These Work

- Bright-line rules reduce rationalization; absolute language eliminates "is this an exception?" questions
- Implementation intentions ("When X, do Y") create automatic behavior more effectively than "generally do Y"
- Clear triggers + required actions = reduced cognitive load on compliance

---

## 13. Skill Creation Process

### Step-by-Step Workflow

1. **Understand the skill with concrete examples** - Ask users for specific use cases, triggers, and examples
2. **Plan reusable skill contents** - Analyze each example to identify scripts, references, and assets
3. **Initialize the skill** - Run `init_skill.py` to generate template structure
4. **Edit the skill** - Implement resources and write SKILL.md
5. **Package the skill** - Run `package_skill.py` for validation and distribution
6. **Iterate based on real usage** - Use, observe struggles, update, test again

### Iteration Workflow

1. Use the skill on real tasks
2. Notice struggles or inefficiencies
3. Identify how SKILL.md or bundled resources should be updated
4. Implement changes and test again

### Observing Claude's Navigation

Pay attention to how Claude actually uses skills in practice:
- **Unexpected exploration paths**: Structure may not be as intuitive as intended
- **Missed connections**: Links may need to be more explicit or prominent
- **Overreliance on certain sections**: Content may belong in SKILL.md instead
- **Ignored content**: File may be unnecessary or poorly signaled

---

## 14. Validation Rules (from quick_validate.py)

The validation script enforces these rules:

- SKILL.md must exist in the skill directory
- Must start with valid YAML frontmatter (`---` delimiters)
- Only allowed frontmatter properties: `name`, `description`, `license`, `allowed-tools`, `metadata`
- `name` is required, must be a string in hyphen-case (`[a-z0-9-]+`), max 64 characters
- `description` is required, must be a string, max 1024 characters, no angle brackets (`<` or `>`)
- Name cannot start/end with hyphen or contain consecutive hyphens

---

## 15. File Organization Patterns

### Self-Contained Skill
```
defense-in-depth/
  SKILL.md    # Everything inline
```
**When**: All content fits, no heavy reference needed.

### Skill with Reusable Tool
```
condition-based-waiting/
  SKILL.md    # Overview + patterns
  example.ts  # Working helpers to adapt
```
**When**: Tool is reusable code, not just narrative.

### Skill with Heavy Reference
```
pptx/
  SKILL.md       # Overview + workflows
  pptxgenjs.md   # 600 lines API reference
  ooxml.md       # 500 lines XML structure
  scripts/       # Executable tools
```
**When**: Reference material too large for inline.

### Separate by Domain
```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── reference/
    ├── finance.md
    ├── sales.md
    ├── product.md
    └── marketing.md
```
**When**: Multiple domains, only one relevant per query.

### Separate by Variant/Framework
```
cloud-deploy/
├── SKILL.md (workflow + provider selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
**When**: Multiple variants, user chooses one.

---

## Sources

This document was compiled from:

- `/Users/meixueting/.claude/skills/skill-creator/SKILL.md` - Skill Creator main guide
- `/Users/meixueting/.claude/skills/skill-creator/references/workflows.md` - Workflow patterns
- `/Users/meixueting/.claude/skills/skill-creator/references/output-patterns.md` - Output patterns
- `/Users/meixueting/.claude/skills/skill-creator/scripts/quick_validate.py` - Validation rules
- `/Users/meixueting/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-skills/SKILL.md` - Writing skills (TDD approach)
- `/Users/meixueting/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-skills/anthropic-best-practices.md` - Anthropic official best practices
- `/Users/meixueting/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-skills/persuasion-principles.md` - Persuasion principles for skill design
- `/Users/meixueting/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/writing-skills/testing-skills-with-subagents.md` - Testing methodology
