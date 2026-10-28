import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { hostname } from "node:os";
import { inside } from "../workstreams/context.mjs";

const ROOT = ".planning/agt/model-runs";
const assert = (ok, message) => { if (!ok) throw Error(message); };
const text = value => typeof value === "string" && value.trim().length > 0;
const hash = value => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const outcomes = ["pass", "implementation_failure", "environment_failure", "cancelled"];

export function runPath(project, id) {
  assert(typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id), "A stable task_id (letters, digits, underscore or hyphen) is required");
  return inside(project, `${ROOT}/${id}.json`);
}
export function readRun(project, id) {
  const file = runPath(project, id);
  if (!existsSync(file)) return null;
  const run = JSON.parse(readFileSync(file, "utf8"));
  assert(run.schema_version === 1 && run.task_id === id && Array.isArray(run.attempts), "Invalid model run record");
  return run;
}
export const failureCount = run => (run?.attempts ?? []).filter(a => a.outcome === "implementation_failure").length;
function identity(packet, context, task) {
  return hash(JSON.stringify({ objective: packet.objective, inputs: packet.inputs, write_scope: packet.write_scope,
    acceptance: packet.acceptance, read_only: packet.read_only === true, context, task }));
}
export function taskHistory(project, packet, context, task) {
  runPath(project, packet.task_id);
  assert(text(packet.risk_reason), "Task packet requires a concrete risk_reason");
  const run = readRun(project, packet.task_id);
  if (run) {
    assert(run.identity === identity(packet, context, task), "task_id belongs to a different scope/definition; preserve it and use a new task_id for changed work");
    assert(run.attempts.at(-1)?.outcome, "Previous attempt needs a record receipt before another dispatch");
    assert(run.attempts.at(-1)?.outcome !== "pass", "Task already passed; use a new task_id for new work");
    const risks = ["normal", "high", "critical"];
    assert(risks.indexOf(packet.risk) >= Math.max(...run.attempts.map(a => risks.indexOf(a.route.risk))), "Cannot lower a recorded task risk");
  }
  return { failures: failureCount(run), prior_attempts: (run?.attempts ?? []).map(a => ({ attempt: a.number, outcome: a.outcome,
    model: a.route.model, summary: a.summary, evidence: a.evidence?.map(e => e.path) ?? [] })) };
}
function mutate(project, id, change) {
  const file = runPath(project, id);
  mkdirSync(dirname(file), { recursive: true });
  let fd;
  try { fd = openSync(`${file}.lock`, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") throw Error("Model task is locked; inspect owner before recovering a stale lock"); throw error; }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), started_at: now() }));
    const run = change(readRun(project, id));
    run.updated_at = now();
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(run, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, file);
    return run;
  } finally { closeSync(fd); unlinkSync(`${file}.lock`); }
}
export function reserveRun(project, { packet, context, route, lock_hash, prompt_hash, mode }) {
  assert(["cli", "native"].includes(mode), "Unknown execution mode");
  return mutate(project, packet.task_id, previous => {
    const history = taskHistory(project, packet, context, route.task);
    assert(history.failures === route.failures, "Failure history changed; resolve again before dispatch");
    const run = previous ?? { schema_version: 1, task_id: packet.task_id, identity: identity(packet, context, route.task), context, attempts: [], created_at: now() };
    run.attempts.push({ number: run.attempts.length + 1, mode, route, risk_reason: packet.risk_reason, lock_hash, prompt_hash,
      started_at: now(), outcome: null, execution: "pending", runtime_id: null, actual_model: "not_observed", usage: null });
    return run;
  });
}
export function runtimeObservation(raw, expectedRuntime = null) {
  const models = new Set(), efforts = new Set(), ids = new Set();
  let usage = null, totals = null;
  for (const line of raw.split("\n")) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    const p = event.payload ?? event;
    if (event.type === "thread.started" && text(event.thread_id)) ids.add(event.thread_id);
    if (event.type === "session_meta" && text(p.id ?? p.session_id)) ids.add(p.id ?? p.session_id);
    if (event.type === "turn_context") {
      if (text(p.model)) models.add(p.model);
      if (text(p.effort)) efforts.add(p.effort);
    }
    if (event.type === "token_usage_record" && p.thread_token_usage) usage = p.thread_token_usage;
    if (event.type === "turn.completed" && p.usage) {
      totals ??= {};
      for (const [key, value] of Object.entries(p.usage)) if (Number.isFinite(value) && value >= 0) totals[key] = (totals[key] ?? 0) + value;
    }
  }
  assert(ids.size <= 1, "Runtime evidence mixes multiple sessions");
  const runtime_id = [...ids][0] ?? null;
  if (expectedRuntime) assert(runtime_id === expectedRuntime, "Runtime evidence does not match the recorded runtime_id");
  // A configured runtime model is observable; it is not provider-side or billing attestation.
  return { runtime_id, actual_model: models.size === 1 ? [...models][0] : models.size ? "mixed" : "not_observed",
    observed_models: [...models], actual_effort: efforts.size === 1 ? [...efforts][0] : efforts.size ? "mixed" : null,
    model_observation: models.size ? "runtime_configuration" : "not_observed",
    usage: usage ?? totals, usage_scope: usage || totals ? "recorded_session_only_not_billing" : "unknown" };
}
function mergeObservation(previous, observed) {
  // Supplemental logs may omit fields, but must never erase an earlier mismatch.
  const models = new Set([...(previous.observed_models ?? []), ...(observed.observed_models ?? [])]);
  for (const value of [previous.actual_model, observed.actual_model]) if (value && value !== "not_observed") models.add(value);
  const efforts = new Set([previous.actual_effort, observed.actual_effort].filter(Boolean));
  const actual_model = models.has("mixed") || models.size > 1 ? "mixed" : [...models][0] ?? "not_observed";
  return { ...observed, actual_model, observed_models: [...models].filter(value => value !== "mixed"),
    actual_effort: efforts.has("mixed") || efforts.size > 1 ? "mixed" : [...efforts][0] ?? null,
    model_observation: actual_model === "not_observed" ? "not_observed" : "runtime_configuration",
    usage: observed.usage ?? previous.usage ?? null,
    usage_scope: observed.usage ? observed.usage_scope : previous.usage_scope ?? "unknown" };
}
function evidence(project, paths, id) {
  assert(Array.isArray(paths) && paths.length > 0 && paths.every(text), "Outcome requires evidence file paths");
  return paths.map(path => {
    assert(path !== `${ROOT}/${id}.json`, "Evidence cannot be its own mutable model record");
    const bytes = readFileSync(inside(project, path)), sha256 = hash(bytes);
    const snapshot = `${ROOT}/evidence/${sha256}`;
    const file = inside(project, snapshot);
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    assert(hash(readFileSync(file)) === sha256, "Saved original evidence changed");
    return { path, sha256, snapshot };
  });
}
export function recordExecution(project, id, attempt, result) {
  return mutate(project, id, run => {
    assert(run, "Unknown model task");
    const a = run.attempts.at(-1);
    assert(a.number === attempt && !a.outcome, "Attempt is stale or already closed");
    assert(a.execution === "pending", "Execution already recorded; cannot overwrite its exit or runtime observations");
    const allowed = ["exit_code", "runtime_id", "actual_model", "observed_models", "actual_effort", "model_observation", "usage", "usage_scope", "observation_error", "execution_evidence"];
    assert(Object.keys(result).every(key => allowed.includes(key)), "Unknown execution result field; outcomes require recordOutcome");
    assert(Number.isInteger(result.exit_code), "Process exit code required");
    Object.assign(a, result, { execution: result.exit_code === 0 ? "completed_needs_review" : "failed_needs_classification", ended_at: now() });
    return run;
  });
}
export function recordOutcome(project, id, receipt) {
  return mutate(project, id, run => {
    assert(run, "Unknown model task");
    const a = run.attempts.at(-1);
    assert(receipt.attempt === a.number && !a.outcome, "Attempt is stale or already closed");
    assert(outcomes.includes(receipt.outcome) && text(receipt.summary), "Receipt requires outcome and evidence-based summary");
    assert(!Object.hasOwn(receipt, "actual_model") && !Object.hasOwn(receipt, "usage"), "Model/usage must come from runtime evidence, not an asserted receipt field");
    const files = evidence(project, receipt.evidence, id);
    if (a.mode === "native" && receipt.outcome !== "cancelled") assert(text(receipt.runtime_id), "Native outcome requires the actual runtime_id");
    if (a.runtime_id && receipt.runtime_id) assert(a.runtime_id === receipt.runtime_id, "Runtime ID changed");
    if (receipt.runtime_log) {
      assert(text(receipt.runtime_id ?? a.runtime_id), "Runtime log requires the matching runtime_id");
      const path = isAbsolute(receipt.runtime_log) ? receipt.runtime_log : inside(project, receipt.runtime_log);
      const bytes = readFileSync(path);
      Object.assign(a, mergeObservation(a, runtimeObservation(bytes.toString("utf8"), receipt.runtime_id ?? a.runtime_id)));
      a.runtime_evidence = { path: receipt.runtime_log, sha256: hash(bytes) };
    }
    if (receipt.outcome === "pass") {
      assert(!a.observation_error, "Runtime observation failed; cannot claim a compliant pass");
      assert(a.exit_code === undefined || a.exit_code === 0, "Failed process cannot be accepted; classify and retry");
      if (a.mode === "cli") assert(a.execution === "completed_needs_review" && a.exit_code === 0, "CLI execution must complete successfully before acceptance");
      assert(a.actual_model === "not_observed" || a.actual_model === a.route.model, "Observed model differs from route; cannot claim a compliant pass");
      assert(!a.actual_effort || a.actual_effort === a.route.effort, "Observed effort differs from route");
    }
    a.runtime_id ??= receipt.runtime_id ?? null;
    if (a.mode === "native") a.execution = "reported";
    Object.assign(a, { outcome: receipt.outcome, summary: receipt.summary, evidence: files, reviewed_at: now() });
    return run;
  });
}
export function runSummary(run) {
  assert(run, "Unknown model task");
  return { task_id: run.task_id, failures: failureCount(run), context: run.context, attempts: run.attempts.map(a => ({
    number: a.number, mode: a.mode, task: a.route.task, tier: a.route.tier, requested_model: a.route.model,
    requested_effort: a.route.effort, risk: a.route.risk, risk_reason: a.risk_reason, outcome: a.outcome,
    execution: a.execution, exit_code: a.exit_code, runtime_id: a.runtime_id, actual_model: a.actual_model, actual_effort: a.actual_effort ?? null,
    model_observation: a.model_observation ?? "not_observed", observation_error: a.observation_error,
    usage: a.usage, usage_scope: a.usage_scope ?? "unknown", summary: a.summary, evidence: a.evidence,
  })) };
}
