#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolveContext } from "./context.mjs";
import * as streams from "./workstreams.mjs";

const help = `agt-workstream <command> --project PATH [options]
  context                         Resolve scoped state/registry/artifacts (read-only)
  enable --profile FILE --target BRANCH (--milestone M001 | --quick Q001-slug) --approval SOURCE
  create --id SLUG --title TEXT --scope TEXT --agent product-NAME [--path PATH] [--dependencies JSON_ARRAY]
  list                            Show live and committed progress (read-only)
  resume --id SLUG [--path PATH]   Locate/recreate a worktree; does not steal a session
  claim --id SLUG --owner LABEL --pid PID
  release --id SLUG --token TOKEN
  recover --id SLUG --token TOKEN  Only if the recorded process has exited
  recover --operation-lock --token TOKEN
  activate --role ROLE --agent NAME --token TOKEN --approval SOURCE
  checkpoint --token TOKEN         Back up local planning outside product Git history
  accept --token TOKEN --approval PATH --decision ID --evidence JSON_ARRAY
  integrate --id SLUG              Prepare/resume a local integration candidate
  check --id SLUG --checks FILE    JSON array of argv arrays; executes in candidate
  finish --id SLUG                 Fast-forward target after matching checks
  pause-integration --id SLUG      Release integration slot; retain recovery data
  cleanup --id SLUG                Remove clean, integrated worktrees; keep branches

Requires Git, Node.js and Ruby (same YAML reader as existing validators).
No command pushes, deploys, auto-approves stages or changes the global Codex setup.
See core/workstreams.md for adoption, authorization and session lifecycle.
`;
try {
  const args = process.argv.slice(2), command = args.shift();
  if (!command || ["--help", "help"].includes(command)) { process.stdout.write(help); }
  else {
    const options = {};
    const allowed = {
      context: [], enable: ["profile", "target", "milestone", "quick", "approval"], create: ["id", "title", "scope", "agent", "path", "dependencies"],
      list: [], resume: ["id", "path"], claim: ["id", "owner", "pid"], release: ["id", "token"], recover: ["id", "token", "operation-lock"],
      activate: ["role", "agent", "token", "approval"], checkpoint: ["token"], accept: ["token", "approval", "decision", "evidence"], integrate: ["id"],
      check: ["id", "checks"], finish: ["id"], "pause-integration": ["id"], cleanup: ["id"],
    };
    if (!allowed[command]) throw Error(`Unknown command: ${command}`);
    while (args.length) {
      const option = args.shift();
      if (!option.startsWith("--")) throw Error(`Unexpected argument: ${option}`);
      const key = option.slice(2);
      if (!["project", ...allowed[command]].includes(key) || Object.hasOwn(options, key)) throw Error(`Invalid or duplicate option: ${option}`);
      options[key] = key === "operation-lock" ? true : args.shift();
      if (options[key] === undefined) throw Error(`Missing value: ${option}`);
    }
    const project = options.project || process.cwd();
    for (const key of ["dependencies", "evidence"]) if (options[key]) options[key] = JSON.parse(options[key]);
    if (options.checks) options.commands = JSON.parse(readFileSync(options.checks, "utf8"));
    options.operationLock = options["operation-lock"];
    const action = command === "context" ? resolveContext : command === "pause-integration" ? streams.pauseIntegration : streams[command];
    const result = action(project, options);
    // Entry points stay small; the adopted Profile remains in the config file.
    if (result.config) {
      result.configuration = result.config.planning_storage === "local" ? ".agt/workstreams.json" : ".planning/agt/workstreams.json";
      result.profile = `${result.config.profile.id}@${result.config.profile.version}`;
      result.integration_target = result.config.target;
      delete result.config;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
