#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, validatePolicy, validateCatalog, validateLock, discoverModels, resolveRoute, makeLock, writeNewLock, checkUpdates, readActiveState, launchSpec } from "./model-router.mjs";

const frameworkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const help = [
  "AGT model routing (Node >=20.11; launch also requires Ruby and an active AGT project)",
  "catalog [--codex PATH]                         Discover live Codex metadata; no model turn",
  "resolve --stage S --role R [--task T] [--risk normal|high|critical] [--failures N]",
  "lock --output NEW_FILE --approval REFERENCE    Snapshot policy/catalog; never overwrite",
  "check-updates --lock FILE                     Compare live capabilities and candidate policy",
  "launch --project DIR --lock FILE --packet FILE --task T [--failures N] [--run]",
  "Common: --policy FILE, --inventory FILE (offline resolve/lock/check only), --codex PATH",
  "launch defaults to dry-run. --run starts a new Codex exec session with explicit model/effort.",
  "No global Codex config, workflow state or existing locks are edited. No automatic retries."
].join("\n");

function parse(argv) {
  const command = argv.shift();
  const allowed = {
    catalog: ["codex"], resolve: ["policy", "inventory", "codex", "lock", "stage", "role", "task", "risk", "failures"],
    lock: ["policy", "inventory", "codex", "output", "approval"],
    "check-updates": ["policy", "inventory", "codex", "lock"],
    launch: ["policy", "codex", "lock", "project", "packet", "task", "failures", "run"]
  };
  if (!command || ["help", "--help", "-h"].includes(command)) return { command: "help", options: {} };
  if (!Object.hasOwn(allowed, command)) throw Error("Unknown command; see --help");
  const options = {};
  while (argv.length) {
    const flag = argv.shift();
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed[command].includes(key) || Object.hasOwn(options, key)) throw Error("Unknown or duplicate option: " + flag);
    if (key === "run") options[key] = true;
    else {
      const value = argv.shift();
      if (!value || value.startsWith("--")) throw Error("Missing value for " + flag);
      options[key] = value;
    }
  }
  return { command, options };
}

async function main() {
  const { command, options: o } = parse(process.argv.slice(2));
  if (command === "help") { console.log(help); return; }
  const required = key => { if (!o[key]) throw Error("--" + key + " is required"); return o[key]; };
  // Validate arguments before opening a metadata connection.
  if (command === "resolve") { required("stage"); required("role"); }
  if (command === "lock") { required("output"); required("approval"); }
  if (["check-updates", "launch"].includes(command)) required("lock");
  if (command === "launch") { required("project"); required("packet"); required("task"); }
  if (o.failures !== undefined && !/^(0|[1-9][0-9]*)$/.test(o.failures)) throw Error("Invalid failure count");
  const binary = o.codex ?? "codex";
  const policy = validatePolicy(readJson(o.policy ?? join(frameworkRoot, "models/codex-balanced.json")));
  const lock = o.lock ? validateLock(readJson(o.lock)) : null;
  const toolOnly = command === "resolve" && (lock?.policy ?? policy).tasks[o.task]?.tier === "tool";
  const catalog = toolOnly ? null : o.inventory ? validateCatalog(readJson(o.inventory)) : await discoverModels(binary);
  const output = data => console.log(JSON.stringify(data, null, 2));
  if (command === "catalog") { output(catalog); return; }
  if (command === "lock") {
    const value = makeLock(policy, catalog, o.approval); writeNewLock(resolve(o.output), value);
    output({ written: resolve(o.output), policy_hash: value.policy_hash, approval: value.approval, inference_calls: 0 }); return;
  }
  if (command === "check-updates") {
    const result = checkUpdates(lock, catalog, policy); output(result);
    if (result.issues.length) process.exitCode = 2;
    return;
  }
  if (command === "resolve") {
    output(resolveRoute(lock?.policy ?? policy, catalog, { stage: o.stage, role: o.role, task: o.task, risk: o.risk, failures: Number(o.failures ?? 0) })); return;
  }
  const project = resolve(o.project);
  const state = readActiveState(project), packet = readJson(resolve(o.packet));
  const update = checkUpdates(lock, catalog, policy);
  // Check all bindings, not just today's task: a partially unusable lock needs review.
  if (update.issues.length) { output(update); throw Error("Locked catalog capabilities changed; review before execution"); }
  const route = resolveRoute(lock.policy, catalog, { stage: state.stage, role: state.active_role, task: o.task, risk: packet.risk, failures: Number(o.failures ?? 0) });
  if (route.mode === "tool") { output(route); return; }
  const spec = launchSpec(project, route, packet, frameworkRoot);
  output({ mode: o.run ? "launch" : "dry-run", active_agent: state.active_agent, route, updates: update,
    command: [binary, ...spec.args], prompt_hash: spec.prompt_hash, actual_model: "not_observed",
    note: "This is a new session, not a model switch for an existing App chat. Permission settings are inherited, not broadened." });
  if (!o.run) return;
  const child = spawn(binary, spec.args, { stdio: ["pipe", "inherit", "inherit"], cwd: project });
  child.on("error", () => { console.error("Codex launch failed"); process.exitCode = 1; });
  child.stdin.on("error", () => {});
  child.stdin.end(spec.prompt);
  const forward = signal => child.kill(signal);
  const interrupt = () => forward("SIGINT"), terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  child.on("exit", (code, signal) => {
    process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
