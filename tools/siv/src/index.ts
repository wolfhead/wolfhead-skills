#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("siv")
  .description("Self-improvement CLI for AI coding agents")
  .version("0.1.0");

program.parse();
