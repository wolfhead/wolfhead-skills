# LLM Prompt Engineering Best Practices

A comprehensive guide to writing effective prompts for Large Language Models, synthesized from OpenAI, Anthropic, Google, and community research (as of March 2026).

---

## Table of Contents

1. [Foundational Principles](#1-foundational-principles)
2. [Prompt Structure](#2-prompt-structure)
3. [Core Techniques](#3-core-techniques)
4. [Advanced Techniques](#4-advanced-techniques)
5. [Model-Specific Tips](#5-model-specific-tips)
6. [Anti-Patterns to Avoid](#6-anti-patterns-to-avoid)
7. [Production Considerations](#7-production-considerations)
8. [Sources](#8-sources)

---

## 1. Foundational Principles

### Be Clear and Specific

The single most impactful thing you can do is reduce ambiguity. Vague instructions produce vague results.

**Bad:**
```
Summarize this article.
```

**Good:**
```
Summarize this article in 3 bullet points, each under 20 words, focusing on the key technical findings.
```

### Provide Context

Give the model the information it needs to do its job. Include relevant background, constraints, and the purpose of the task.

```
You are reviewing a pull request for a Python web service that handles payment processing.
The codebase uses Flask, SQLAlchemy, and follows PEP 8 conventions.

Review the following code for security vulnerabilities, focusing on SQL injection and input validation:

<code>
...
</code>
```

### Specify the Output Format

Tell the model exactly what structure you want — length, format, tone, and style.

```
Return the result as a JSON object with keys: "summary" (string, max 100 words),
"sentiment" (one of: positive, negative, neutral), and "confidence" (float 0-1).
```

### Iterate and Refine

Prompt engineering is iterative. Start simple, test, review the output, and refine. The first prompt is rarely the best one.

---

## 2. Prompt Structure

### System Prompt vs User Prompt

| Aspect | System Prompt | User Prompt |
|--------|--------------|-------------|
| Purpose | Persistent rules, role, constraints, safety guardrails | Per-request input data and intent |
| Scope | Applies to the entire conversation | Applies to a single turn |
| Content | Identity, tone, format rules, non-negotiable constraints | The actual task, question, or data |

**Best practice:** Put role definitions, output format rules, and behavioral constraints in the system prompt. Put task-specific data and instructions in the user prompt.

### Role Prompting

Assigning a role focuses the model's behavior, tone, and expertise.

```
You are a senior security engineer with 15 years of experience in penetration testing.
Analyze the following network configuration for vulnerabilities.
```

Even a single sentence of role definition measurably improves output quality.

### Ordering and Placement

- **Long documents first:** For inputs over 20K tokens, place documents at the top, instructions at the bottom. This can improve response quality by up to 30% (Anthropic testing).
- **Questions last:** Place the specific question or task at the end of the prompt, after all context.
- **Images first:** For vision tasks, place images at the start of the prompt.

### Use Delimiters and Structure

Use clear separators to distinguish between instructions, context, and data. XML tags, markdown headers, or triple-hash (`###`) separators all work.

```xml
<instructions>
Classify the customer feedback into categories.
</instructions>

<categories>
- Product Quality
- Customer Service
- Pricing
- Shipping
</categories>

<feedback>
The delivery took 3 weeks and the box was damaged.
</feedback>
```

Claude specifically benefits from XML tags (`<example>`, `<document>`, `<instructions>`) due to its training data.

---

## 3. Core Techniques

### Zero-Shot Prompting

Give a direct instruction with no examples. Works well for tasks the model is already familiar with.

```
Translate the following English text to French: "The weather is beautiful today."
```

**When to use:** Simple, well-defined tasks where the model already understands the expected behavior.

### Few-Shot Prompting

Provide 1–5 examples of input-output pairs before the actual task. This is one of the highest-ROI techniques available.

```
Classify the sentiment of each review.

Review: "The food was amazing and the service was excellent!"
Sentiment: Positive

Review: "Waited 45 minutes and the order was wrong."
Sentiment: Negative

Review: "It was okay, nothing special but not bad either."
Sentiment: Neutral

Review: "The ambiance was nice but the prices were outrageous."
Sentiment:
```

**Best practices for few-shot examples:**
- Use diverse examples that cover edge cases
- Keep examples consistent in format
- 3–5 examples is usually the sweet spot
- Match the complexity of examples to the actual task

### Chain-of-Thought (CoT) Prompting

Instruct the model to show its reasoning step by step. This significantly improves accuracy on complex reasoning, math, and logic tasks.

```
Solve the following problem step by step:

A store has 45 apples. They receive a shipment of 3 boxes, each containing 12 apples.
They then sell 20% of their total stock. How many apples remain?

Think through this step by step before giving the final answer.
```

**Key insight (2025 research):** For modern strong reasoning models (e.g., o1, Claude with extended thinking), explicit CoT prompting may be unnecessary or even counterproductive — these models reason internally. CoT remains valuable for standard/non-reasoning models.

### Self-Consistency

Run the same prompt multiple times and take the majority answer. This reduces variance and improves reliability for tasks with a single correct answer.

---

## 4. Advanced Techniques

### Task Decomposition

Break complex tasks into smaller, focused sub-tasks. Each sub-task gets its own prompt.

**Instead of:**
```
Analyze this codebase, find all bugs, fix them, write tests, and update the documentation.
```

**Do:**
1. Prompt 1: "List all potential bugs in this code."
2. Prompt 2: "For each bug identified, suggest a fix with code."
3. Prompt 3: "Write unit tests for the fixed code."
4. Prompt 4: "Update the documentation to reflect the changes."

### ReAct (Reason + Act)

Combine reasoning with tool use in an interleaved loop: Think → Act → Observe → Repeat. This is the foundation of most modern AI agent architectures.

```
Answer the following question using the tools available to you.
Think step by step about what information you need,
use the appropriate tool to get it,
observe the result, and continue until you can answer.

Question: What was the GDP growth rate of the top 3 economies in 2025?
```

### Structured Output with Schemas

Define explicit input and output schemas to minimize ambiguity.

```
Extract entities from the text and return them in this exact JSON schema:

{
  "persons": [{"name": string, "role": string}],
  "organizations": [{"name": string, "type": "company" | "government" | "nonprofit"}],
  "dates": [{"value": string, "context": string}]
}

Text: ...
```

Most modern APIs also support native structured output / JSON mode — use these when available.

### Self-Critique / Reflection

Ask the model to review and critique its own output before finalizing.

```
First, draft a response to the question below.
Then, review your draft for factual errors, logical gaps, and missing context.
Finally, provide your improved final answer.
```

### Least-to-Most Prompting

For complex problems, first break the problem into sub-problems, then solve each one sequentially, building on previous answers.

```
To solve this problem, first identify the sub-problems that need to be solved.
Then solve each sub-problem in order, using the results of previous steps.
```

---

## 5. Model-Specific Tips

### Claude (Anthropic)

- Use **XML tags** to structure prompts — Claude was trained with XML in its data
- Place **long documents at the top**, queries at the bottom
- Be **explicit** about desired behavior — Claude tends to be conservative; say "be thorough" if you want depth
- Use the **system prompt** for role and constraints
- For vision: place images at the start

### GPT-4 / OpenAI Models

- Use **separators** (`###`, `"""`) to delineate sections
- Set **temperature to 0** for factual / deterministic tasks
- Leverage **few-shot examples** — OpenAI recommends this as a primary technique
- For structured output, use the **JSON mode** or **structured outputs API**

### Gemini (Google)

- Prefers **shorter, more direct prompts** than Claude or GPT
- Always include **few-shot examples** (Google explicitly recommends against zero-shot)
- Place specific questions at the end, after context data
- Supports **multimodal inputs** natively — mix text, images, and code

### Reasoning Models (o1, Claude Extended Thinking, DeepSeek R1)

- **Don't use explicit CoT** — these models reason internally, and adding "think step by step" can hurt performance
- Use **direct, clear instructions** instead
- Focus on **what** you want, not **how** to think about it

---

## 6. Anti-Patterns to Avoid

### 1. Vague Instructions

```
# Bad
Tell me about databases.

# Good
Compare PostgreSQL and MySQL for a read-heavy analytics workload
processing 10M rows/day. Cover query performance, indexing, and
operational complexity. Limit to 300 words.
```

### 2. Overloading a Single Prompt

Packing too many distinct tasks into one prompt divides the model's attention and degrades quality. Split into focused prompts.

### 3. Missing Examples

When format or style matters, always include examples. Few-shot prompting is the highest-ROI improvement for most tasks.

### 4. Ignoring Prompt Length

Research shows LLM reasoning performance degrades around 3,000 tokens of instructions. The practical sweet spot is **150–300 words** for most task prompts. More isn't always better.

### 5. Applying Wrong Techniques to Wrong Models

- Don't use explicit CoT with reasoning models (o1, etc.)
- Don't use zero-shot when format precision matters — add examples
- Don't over-engineer multi-agent systems for simple tasks

### 6. Treating Output as Ground Truth

Always verify LLM outputs, especially for factual claims, code, and calculations. Use self-critique prompts or external validation.

### 7. Over-Specifying in One Monolithic Prompt

Listing 20+ requirements in a single prompt exceeds the model's instruction-following capacity. Break requirements into layers: system prompt (persistent rules), user prompt (task-specific), and follow-up refinements.

### 8. No Iteration

The first prompt is almost never optimal. Budget time for testing, evaluating, and refining prompts systematically.

---

## 7. Production Considerations

### Prompt Versioning

Track prompt versions like code. When you change a prompt, test it against a consistent evaluation set before deploying.

### Evaluation

- Define clear success metrics before writing prompts
- Build a test suite of representative inputs with expected outputs
- Measure accuracy, consistency, and edge case handling
- Use automated evaluation where possible (LLM-as-judge, regex matching, schema validation)

### Temperature and Parameters

| Use Case | Temperature | Notes |
|----------|------------|-------|
| Factual Q&A, extraction | 0–0.2 | Deterministic, consistent |
| Creative writing, brainstorming | 0.7–1.0 | More varied, creative |
| Code generation | 0–0.3 | Precision matters |
| General conversation | 0.5–0.7 | Balanced |

### Cost and Latency

- Shorter prompts = lower cost and faster responses
- Use cheaper/faster models for simple tasks, powerful models for complex ones
- Cache common prompt prefixes where the API supports it (e.g., Anthropic's prompt caching)
- Batch similar requests when possible

### Safety and Guardrails

- Include safety instructions in system prompts
- Test for prompt injection vulnerabilities
- Validate outputs before acting on them programmatically
- Use API-level content filters when available

---

## 8. Sources

- [Anthropic: Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [OpenAI: Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [OpenAI: Best Practices for Prompt Engineering](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-the-openai-api)
- [Google: Prompt Design Strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- [Google: Prompt Engineering Whitepaper (Kaggle)](https://www.kaggle.com/whitepaper-prompt-engineering)
- [Prompt Engineering Guide (DAIR.AI)](https://www.promptingguide.ai/techniques/cot)
- [Lakera: The Ultimate Guide to Prompt Engineering in 2026](https://www.lakera.ai/blog/prompt-engineering-guide)
- [10 Best Practices for Production-Grade LLM Prompt Engineering](https://latitude-blog.ghost.io/blog/10-best-practices-for-production-grade-llm-prompt-engineering/)
- [Common Prompt Engineering Mistakes to Avoid in 2026](https://treyworks.com/common-prompt-engineering-mistakes-to-avoid/)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [IBM: What is Chain of Thought Prompting?](https://www.ibm.com/think/topics/chain-of-thoughts)
- [Revisiting Chain-of-Thought Prompting (arXiv, 2025)](https://arxiv.org/abs/2506.14641)
