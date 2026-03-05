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
  .description("Log a new finding")
  .requiredOption("-c, --category <category>", "Finding category (correction, error, knowledge_gap, best_practice, feature_request)")
  .requiredOption("-s, --summary <summary>", "Short summary of the finding")
  .option("-d, --details <details>", "Detailed description")
  .option("-p, --priority <priority>", "Priority level (low, medium, high, critical)", "medium")
  .option("--project <project>", "Project name")
  .option("--project-path <path>", "Project path")
  .option("--session <session>", "Session identifier")
  .option("--source <source>", "Finding source (analyze, manual, hook)", "manual")
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
  .option("--latest <n>", "Number of recent sessions", "5")
  .option("--project-path <path>", "Filter by project path")
  .option("--since <date>", "Sessions since date (YYYY-MM-DD)")
  .option("--session <id>", "Analyze specific session")
  .action(async (options) => {
    const { executeAnalyze } = await import("./commands/analyze.js");
    await executeAnalyze({
      latest: parseInt(options.latest),
      projectPath: options.projectPath,
      since: options.since,
      session: options.session,
    });
  });

program
  .command("retrieve")
  .description("Get promoted learnings for context injection")
  .option("--project-path <path>", "Project path")
  .option("--global", "Include global learnings")
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
  .command("promote_finding")
  .description("Promote a finding to memory")
  .requiredOption("--finding-ids <ids>", "Comma-separated finding IDs")
  .requiredOption("--scope <scope>", "project|global")
  .option("--project <name>", "Project name")
  .option("--project-path <path>", "Project path")
  .requiredOption("--category <category>", "learning|error|preference")
  .requiredOption("--rule <rule>", "The distilled rule text")
  .action(async (options) => {
    const { executePromoteFinding } = await import("./commands/promote-finding.js");
    const result = await executePromoteFinding({
      findingIds: options.findingIds.split(",").map((s: string) => s.trim()),
      scope: options.scope,
      project: options.project,
      projectPath: options.projectPath,
      category: options.category,
      rule: options.rule,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("run_promotion")
  .description("Scan findings and promote patterns to memory")
  .option("--dry-run", "Show what would be promoted without doing it")
  .option("--window <days>", "Days to look back", "3")
  .action(async (options) => {
    const { executeRunPromotion } = await import("./commands/run-promotion.js");
    await executeRunPromotion({
      dryRun: options.dryRun || false,
      window: parseInt(options.window),
    });
  });

program.parse();
