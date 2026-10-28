#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, validatePolicy, validateCatalog, validateLock, validatePacket, discoverModels, resolveRoute, makeLock, writeNewLock, checkUpdates, readActiveState, launchSpec } from "./model-router.mjs";
import { modelTaskContext } from "../quick/quick-tasks.mjs";
import { git, inside, resolveContext } from "../workstreams/context.mjs";
import { readRun, runPath, runSummary, taskHistory, reserveRun, recordExecution, recordOutcome, runtimeObservation } from "./model-execution.mjs";

const frameworkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const help = [
  "AGT model routing (Node >=20.11; stage launch also requires Ruby)",
  "catalog [--codex PATH]                         Discover live metadata; no model turn",
  "resolve --stage S --role R [--task T] [--risk normal|high|critical] [--failures N]",
  "lock --output NEW_FILE --approval REFERENCE    Snapshot policy/catalog; never overwrite",
  "check-updates --lock FILE                     Compare live capabilities and candidate policy",
  "launch --project DIR --lock FILE --packet FILE --task T [--quick QID --role ROLE] [--run]",
  "dispatch --project DIR --lock FILE --packet FILE --task T [--quick QID --role ROLE]",
  "record --project DIR --task-id ID --receipt FILE",
  "status --project DIR --task-id ID",
  "Common: --policy FILE, --inventory FILE (offline resolve/lock/check only), --codex PATH",
  "launch defaults to read-only dry-run. --run records and starts a new CLI session.",
  "dispatch reserves an attempt and returns native spawn arguments; the host must execute them.",
  "Managed runs require task_id/risk_reason. Failures come from recorded outcomes, never process success alone.",
  "No global config, workflow state or existing locks are edited. No automatic retries."
].join("\n");
const executionOptions = ["policy", "codex", "lock", "project", "packet", "task", "quick", "role"];
function parse(argv) {
  const command = argv.shift();
  const allowed = {
    catalog: ["codex"], resolve: ["policy", "inventory", "codex", "lock", "stage", "role", "task", "risk", "failures"],
    lock: ["policy", "inventory", "codex", "output", "approval"], "check-updates": ["policy", "inventory", "codex", "lock"],
    launch: [...executionOptions, "failures", "run"], dispatch: executionOptions,
    status: ["project", "task-id"], record: ["project", "task-id", "receipt"]
  };
  if (!command || ["help", "--help", "-h"].includes(command)) return { command: "help", options: {} };
  if (!Object.hasOwn(allowed, command)) throw Error("Unknown command; see --help");
  const options = {};
  while (argv.length) {
    const flag = argv.shift(), key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed[command].includes(key) || Object.hasOwn(options, key)) throw Error("Unknown or duplicate option: " + flag);
    if (key === "run") options[key] = true;
    else { const value = argv.shift(); if (!value || value.startsWith("--")) throw Error("Missing value for " + flag); options[key] = value; }
  }
  return { command, options };
}
const output = data => console.log(JSON.stringify(data, null, 2));
// Scope validation, packet paths, ledger paths and execution must share one root.
const projectRoot = path => realpathSync(git(resolve(path), ["rev-parse", "--show-toplevel"], true) || resolve(path));
async function execute(binary, spec, project, packet, run) {
  const attempt = run.attempts.at(-1).number, prefix = runPath(project, packet.task_id).replace(/\.json$/, `-${attempt}`);
  const events = `${prefix}.events.jsonl`, errors = `${prefix}.stderr.log`;
  writeFileSync(events, "", { mode: 0o600, flag: "wx" });
  writeFileSync(errors, "", { mode: 0o600, flag: "wx" });
  const args = [...spec.args.slice(0, -1), "--json", ...(packet.read_only ? ["--sandbox", "read-only"] : []), "-"];
  const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], cwd: project });
  child.stdout.on("data", bytes => appendFileSync(events, bytes));
  child.stderr.on("data", bytes => appendFileSync(errors, bytes));
  child.stdin.on("error", () => {});
  child.stdin.end(spec.prompt);
  const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  const code = await new Promise(resolveExit => {
    child.on("error", error => { appendFileSync(errors, error.message + "\n"); });
    child.on("close", code => resolveExit(code ?? 1));
  });
  process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
  let observation;
  try { observation = runtimeObservation(readFileSync(events, "utf8")); }
  catch (error) { observation = { observation_error: error.message, actual_model: "not_observed", usage: null }; }
  const saved = recordExecution(project, packet.task_id, attempt, { exit_code: code, ...observation,
    execution_evidence: [relative(project, events), relative(project, errors)] });
  output({ ...runSummary(saved), execution_evidence: [relative(project, events), relative(project, errors)], next: "Review output/evidence, then record pass, implementation_failure or environment_failure. Exit 0 is not acceptance." });
  process.exitCode = code;
}
async function main() {
  const { command, options: o } = parse(process.argv.slice(2));
  if (command === "help") { console.log(help); return; }
  const required = key => { if (!o[key]) throw Error("--" + key + " is required"); return o[key]; };
  if (["record", "status"].includes(command)) {
    const project = projectRoot(required("project")), id = required("task-id");
    output(runSummary(command === "record" ? recordOutcome(project, id, readJson(resolve(required("receipt")))) : readRun(project, id)));
    return;
  }
  if (command === "resolve") { required("stage"); required("role"); }
  if (command === "lock") { required("output"); required("approval"); }
  if (["check-updates", "launch", "dispatch"].includes(command)) required("lock");
  const execution = ["launch", "dispatch"].includes(command);
  let project, packet, context, role, stage, history;
  if (execution) {
    project = projectRoot(required("project")); packet = readJson(resolve(required("packet"))); required("task");
    validatePacket(packet, project);
    if (o.quick) {
      role = required("role"); context = modelTaskContext(project, o.quick, role, packet);
    } else {
      if (o.role) throw Error("--role override requires --quick; stage mode uses the active role");
      const state = readActiveState(project), scoped = resolveContext(project);
      role = state.active_role; stage = state.stage;
      context = { mode: "stage", id: scoped.id ?? state.milestone ?? "project", role, active_agent: state.active_agent };
    }
    if (packet.task && packet.task !== o.task) throw Error("Packet task and --task disagree");
    const managed = command === "dispatch" || o.run || packet.task_id;
    if (managed) {
      if (o.failures !== undefined) throw Error("Managed tasks derive failures from receipts; --failures is only for resolve or legacy previews");
      history = taskHistory(project, packet, context, o.task);
      for (const input of packet.inputs) readFileSync(inside(project, input.split("#")[0]));
    }
  }
  if (o.failures !== undefined && !/^(0|[1-9][0-9]*)$/.test(o.failures)) throw Error("Invalid failure count");
  const binary = o.codex ?? "codex";
  const policy = validatePolicy(readJson(o.policy ?? join(frameworkRoot, "models/codex-balanced.json")));
  const lock = o.lock ? validateLock(readJson(o.lock)) : null, effective = lock?.policy ?? policy;
  const toolOnly = (command === "resolve" || execution) && effective.tasks[o.task]?.tier === "tool";
  const catalog = toolOnly ? null : o.inventory ? validateCatalog(readJson(o.inventory)) : await discoverModels(binary);
  if (command === "catalog") { output(catalog); return; }
  if (command === "lock") { const value = makeLock(policy, catalog, o.approval); writeNewLock(resolve(o.output), value); output({ written: resolve(o.output), policy_hash: value.policy_hash, approval: value.approval, inference_calls: 0 }); return; }
  if (command === "check-updates") { const result = checkUpdates(lock, catalog, policy); output(result); if (result.issues.length) process.exitCode = 2; return; }
  if (command === "resolve") { output(resolveRoute(effective, catalog, { stage: o.stage, role: o.role, task: o.task, risk: o.risk, failures: Number(o.failures ?? 0) })); return; }
  const update = toolOnly ? null : checkUpdates(lock, catalog, policy);
  if (update?.issues.length) { output(update); throw Error("Locked catalog capabilities changed; review before execution"); }
  stage ??= effective.roles[role]?.stage;
  const route = resolveRoute(effective, catalog, { stage, role, task: o.task, risk: packet.risk, failures: history?.failures ?? Number(o.failures ?? 0) });
  if (route.mode === "tool") { output({ route, context, note: "Run the approved command directly and retain evidence in the task; no agent is started or model attempt consumed." }); return; }
  const taskPacket = { ...packet, ...(history ? { prior_attempts: history.prior_attempts } : {}) };
  const spec = launchSpec(project, route, taskPacket, frameworkRoot, context);
  if (command === "launch" && !o.run) {
    output({ mode: "dry-run", context, route, updates: update, command: [binary, ...spec.args], prompt_hash: spec.prompt_hash,
      actual_model: "not_observed", note: "No inference or attempt created. --run requires task_id and risk_reason." }); return;
  }
  const run = reserveRun(project, { packet, context, route, lock_hash: lock.policy_hash, prompt_hash: spec.prompt_hash, mode: command === "dispatch" ? "native" : "cli" });
  if (command === "dispatch") {
    output({ mode: "native-dispatch", task_id: packet.task_id, attempt: run.attempts.at(-1).number, context, route, updates: update,
      spawn: { task_name: packet.task_id.toLowerCase().replaceAll("-", "_") + "_a" + run.attempts.at(-1).number, agent_type: "default", fork_turns: "none", model: route.model, reasoning_effort: route.effort, message: spec.prompt },
      actual_model: "not_observed", next: "Host executes these spawn arguments, waits for the result and calls record with the actual runtime_id and evidence. A packet is not an executed task." });
  } else await execute(binary, spec, project, packet, run);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
