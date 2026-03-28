#!/usr/bin/env node
import { Command } from "commander";
import { executeLog } from "./commands/log.js";

const program = new Command();

program
  .name("siv")
  .description("Self-improvement CLI for AI coding agents")
  .version("0.1.0");

program
  .command("log")
  .description("Log a new insight")
  .requiredOption("-c, --category <category>", "Insight category (correction, error, knowledge_gap, best_practice, feature_request)")
  .requiredOption("-s, --summary <summary>", "Short summary of the insight")
  .option("-d, --details <details>", "Detailed description")
  .option("-p, --priority <priority>", "Priority level (low, medium, high, critical)", "medium")
  .option("--project <project>", "Project name")
  .option("--project-path <path>", "Project path")
  .option("--session <session>", "Session identifier")
  .option("--source <source>", "Insight source (analyze, manual, hook)", "manual")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--related <related>", "Comma-separated related file paths")
  .action((opts) => {
    const result = executeLog({
      category: opts.category,
      summary: opts.summary,
      details: opts.details,
      priority: opts.priority,
      project: opts.project,
      projectPath: opts.projectPath,
      session: opts.session,
      source: opts.source,
      tags: opts.tags,
      related: opts.related,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("analyze")
  .description("Analyze session transcripts for learnings")
  .option("--latest <n>", "Number of recent sessions (default: 20)")
  .option("--project-path <path>", "Filter by project path")
  .option("--since <date>", "Sessions since date (YYYY-MM-DD)")
  .option("--session <id>", "Analyze specific session")
  .option("--source <source>", "Source adapter (claude-code-session)", "claude-code-session")
  .action(async (options) => {
    const { executeAnalyze } = await import("./commands/analyze.js");
    await executeAnalyze({
      latest: options.latest ? parseInt(options.latest) : undefined,
      projectPath: options.projectPath,
      since: options.since,
      session: options.session,
      source: options.source,
    });
  });

program
  .command("extract")
  .description("Extract session data as JSON (no LLM, no writes)")
  .option("--latest <n>", "Number of recent sessions (default: 20)")
  .option("--project-path <path>", "Filter by project path")
  .option("--since <date>", "Sessions since date (YYYY-MM-DD)")
  .option("--session <id>", "Extract specific session")
  .option("--summary", "Truncate assistant text for compact output")
  .action(async (options) => {
    const { executeExtract } = await import("./commands/extract.js");
    await executeExtract({
      latest: options.latest ? parseInt(options.latest) : undefined,
      projectPath: options.projectPath,
      since: options.since,
      session: options.session,
      summary: options.summary || false,
    });
  });

program
  .command("retrieve")
  .description("Get consolidated rules for context injection")
  .option("--project-path <path>", "Project path")
  .option("--global", "Include global rules")
  .option("--format <format>", "Output format (text|json)", "text")
  .action(async (options) => {
    const { executeRetrieve } = await import("./commands/retrieve.js");
    const result = executeRetrieve({
      projectPath: options.projectPath,
      global: options.global || false,
      format: options.format,
    });
    console.log(result);
  });

program
  .command("consolidate")
  .description("Consolidate insights into a rule")
  .requiredOption("--insight-ids <ids>", "Comma-separated insight IDs")
  .requiredOption("--scope <scope>", "project|global")
  .option("--project <name>", "Project name")
  .option("--project-path <path>", "Project path")
  .requiredOption("--category <category>", "learning|error|preference")
  .requiredOption("--rule <rule>", "The distilled rule text")
  .action(async (options) => {
    const { executeConsolidate } = await import("./commands/consolidate.js");
    const result = await executeConsolidate({
      insightIds: options.insightIds.split(",").map((s: string) => s.trim()),
      scope: options.scope,
      project: options.project,
      projectPath: options.projectPath,
      category: options.category,
      rule: options.rule,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("status")
  .description("Show insight and rule statistics")
  .option("--project-path <path>", "Filter by project path")
  .action(async (options) => {
    const { executeStatus } = await import("./commands/status.js");
    const output = executeStatus({
      projectPath: options.projectPath,
    });
    console.log(output);
  });

program
  .command("doctor")
  .description("Check configuration and API connectivity")
  .action(async () => {
    const { executeDoctor } = await import("./commands/doctor.js");
    await executeDoctor();
  });

program
  .command("mark")
  .description("Record an emotion marker")
  .argument("<type>", "Marker type (frustration, correction, breakthrough, surprise)")
  .argument("[context...]", "Optional free-text description")
  .action(async (type: string, context: string[]) => {
    const { executeMark } = await import("./commands/mark.js");
    const result = executeMark(type, context.join(" ") || undefined);
    console.log(result);
  });

program
  .command("group")
  .description("Semantically group similar insights using LLM")
  .option("--dry-run", "Show groups without updating insights.jsonl")
  .option("--reset", "Clear existing group labels before re-grouping")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (options) => {
    const { executeGroup } = await import("./commands/group.js");
    await executeGroup({
      dryRun: options.dryRun || false,
      reset: options.reset || false,
      yes: options.yes || false,
    });
  });

program
  .command("run")
  .description("Scan insights and consolidate patterns into rules")
  .option("--dry-run", "Show what would be consolidated without doing it")
  .option("--reset", "Reset all insights to pending and clear rules before running")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--window <days>", "Days to look back", "3")
  .action(async (options) => {
    const { executeRun } = await import("./commands/run.js");
    await executeRun({
      dryRun: options.dryRun || false,
      reset: options.reset || false,
      yes: options.yes || false,
      window: parseInt(options.window),
    });
  });

program.parse();
