#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as quick from "./quick-tasks.mjs";

const help = `AGT Quick — one bounded task, no milestone transition
node adapters/quick/agt-quick.mjs <command> --project <product> [options]
  create --input <spec.json>
  list
  show|resume --id <Q001-slug> [--history]  (read-only; concise by default)
  validate --id <id>  (read-only; checks acceptance, documents and context closeout)
  start --id <id> [--reason <resolved blocker>]
  revise --id <id> --input <spec.json> --reason <change>
  checkpoint --id <id> --summary <work so far> --next <concrete next action>
  dispatch --id <id> --document <DOC1>  (read-only role packet; no agent launch)
  reconcile --id <id> --input <actual-owner-receipt.json>
  verify --id <id> --input <argv-checks.json>
  observe --id <id> --input <observations.json>
  compact --id <id> --input <context-closeout.json>
  finish --id <id>  (uses the reviewed compact outcome)
  block|cancel --id <id> --reason <reason>
  escalate --id <id> --reason <reason> --target <existing scope or decision>
Input files contain data only. verify executes explicit argv without shell expansion.
No automatic Git commit/push, role activation, milestone change or model launch.
See core/quick-tasks.md for adoption, JSON shapes and evidence boundaries.`;
try {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: "string" }, id: { type: "string" }, input: { type: "string" }, document: { type: "string" },
    reason: { type: "string" }, target: { type: "string" }, summary: { type: "string" }, next: { type: "string" }, help: { type: "boolean" }, history: { type: "boolean" },
  } });
  if (v.help || positionals.length === 0) { process.stdout.write(help + "\n"); }
  else {
    if (positionals.length !== 1 || !v.project) throw Error("Exactly one command and --project are required");
    const command = positionals[0];
    if (v.history && !["show", "resume"].includes(command)) throw Error("--history is only for explicit show/resume inspection");
    const input = () => { if (!v.input) throw Error("--input is required"); return JSON.parse(readFileSync(v.input, "utf8")); };
    let result;
    if (command === "list") result = quick.list(v.project);
    else if (["show", "resume", "validate"].includes(command)) result = quick.show(v.project, v.id, { history: !!v.history });
    else if (command === "create") result = quick.create(v.project, input());
    else if (command === "verify") result = quick.verify(v.project, v.id, input());
    else if (command === "observe") result = quick.observe(v.project, v.id, input());
    else if (command === "dispatch") result = quick.dispatch(v.project, v.id, v.document);
    else if (command === "reconcile") result = quick.reconcile(v.project, v.id, input());
    else if (command === "compact") result = quick.compact(v.project, v.id, input());
    else if (["start", "revise", "checkpoint", "finish", "block", "escalate", "cancel"].includes(command)) result = quick.change(v.project, v.id, command, { ...v, spec: command === "revise" ? input() : undefined });
    else throw Error(`Unknown command: ${command}`);
    if (!["list", "show", "resume", "validate", "dispatch"].includes(command)) result = quick.show(v.project, result.id);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (command === "validate" && (!["active", "complete"].includes(result.status) || !result.validation_now.every(x => x.pass) || !result.documents_now.every(x => x.pass) || !result.compaction_now.pass)) process.exitCode = 1;
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
