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

program.parse();
