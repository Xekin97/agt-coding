import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeCatalog, readJson, resolveRoute } from "../adapters/codex/model-router.mjs";
import { failureCount, readRun, recordExecution, recordOutcome, reserveRun, runPath, runSummary, runtimeObservation, taskHistory } from "../adapters/codex/model-execution.mjs";

const root = resolve(import.meta.dirname, "..");
const policy = readJson(join(root, "models/codex-balanced.json"));
const catalog = normalizeCatalog([...new Set(Object.values(policy.bindings).map(b => b.model))]
  .map(model => ({ model, supportedReasoningEfforts: ["medium", "high"] })), "execution-test-fixture");
const context = { mode: "quick", id: "Q001", role_definition: "roles/frontend-implementer/base.md" };
const packet = (overrides = {}) => ({ task_id: "fixture-task", objective: "Repair one approved component",
  inputs: ["approved.md"], write_scope: ["frontend/view.vue"], acceptance: ["The approved assertion passes"],
  risk: "normal", risk_reason: "A bounded local component change", ...overrides });
const route = (p, failures = 0, task = "coding") => resolveRoute(policy, catalog,
  { stage: "implementation", role: "frontend-implementer/base", task, risk: p.risk, failures });
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "agt-execution-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(t, overrides = {}, mode = "cli") {
  const project = temporary(t), p = packet(overrides);
  writeFileSync(join(project, "evidence.txt"), "Actual fixture assertion and its result\n");
  const reserve = (nextPacket = p, nextContext = context, task = "coding") => reserveRun(project, {
    packet: nextPacket, context: nextContext, route: route(nextPacket, taskHistory(project, nextPacket, nextContext, task).failures, task),
    lock_hash: "approved-lock-hash", prompt_hash: "bounded-prompt-hash", mode,
  });
  const receipt = (outcome = "implementation_failure", extras = {}) => ({
    attempt: readRun(project, p.task_id).attempts.at(-1).number,
    outcome, summary: "Reviewed the fixture assertion evidence", evidence: ["evidence.txt"], ...extras,
  });
  const record = (outcome, extras) => recordOutcome(project, p.task_id, receipt(outcome, extras));
  return { project, p, reserve, receipt, record };
}
const jsonl = events => events.map(event => JSON.stringify(event)).join("\n") + "\n";
function runtimeLog(f, events, name = "runtime.jsonl") {
  writeFileSync(join(f.project, name), jsonl(events));
  return name;
}
const runtimeEvents = (model = "gpt-6-luna", effort = "medium", id = "actual-thread") => [
  { type: "thread.started", thread_id: id },
  { type: "turn_context", payload: { model, effort } },
];

test("implementation failures persist across a fresh process and escalate after the risk floor", t => {
  const f = fixture(t, { risk: "high", risk_reason: "This change crosses an authorization boundary" });
  assert.equal(f.reserve().attempts.at(-1).route.tier, "strong");
  f.record("implementation_failure");
  assert.equal(f.reserve().attempts.at(-1).route.tier, "strong");
  f.record("implementation_failure");
  const script = "import {readRun,failureCount} from './adapters/codex/model-execution.mjs'; process.stdout.write(String(failureCount(readRun(process.argv[1],process.argv[2]))));";
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.project, f.p.task_id], { cwd: root, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "2");
  const history = taskHistory(f.project, f.p, context, "coding");
  assert.deepEqual(history.prior_attempts.map(a => a.outcome), ["implementation_failure", "implementation_failure"]);
  assert.deepEqual(history.prior_attempts[0].evidence, ["evidence.txt"]);
  const third = f.reserve().attempts.at(-1);
  assert.equal(third.route.tier, "frontier");
  assert.equal(third.route.failures, 2);
  assert.equal(third.route.model, policy.bindings.frontier.model);
});

test("environment failures and cancellation do not consume implementation retries", t => {
  const f = fixture(t);
  for (const outcome of ["environment_failure", "cancelled", "implementation_failure", "environment_failure"]) {
    f.reserve(); f.record(outcome);
  }
  assert.equal(failureCount(readRun(f.project, f.p.task_id)), 1);
  assert.equal(f.reserve().attempts.at(-1).route.tier, "economy");
});

test("eight evidenced implementation failures stop dispatch", t => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) { f.reserve(); f.record("implementation_failure"); }
  assert.equal(taskHistory(f.project, f.p, context, "coding").failures, 8);
  assert.throws(() => f.reserve(), /ceiling/);
  assert.equal(readRun(f.project, f.p.task_id).attempts.length, 8);
});

test("pending attempts reject repeated dispatch without changing the record", t => {
  const f = fixture(t); f.reserve();
  const before = readFileSync(runPath(f.project, f.p.task_id), "utf8");
  assert.throws(() => f.reserve(), /receipt/);
  assert.equal(readFileSync(runPath(f.project, f.p.task_id), "utf8"), before);
  assert.equal(existsSync(runPath(f.project, f.p.task_id) + ".lock"), false);
});

test("the same task ID cannot acquire different scope, definition, context or category", t => {
  const f = fixture(t); f.reserve(); f.record("implementation_failure");
  for (const change of [{ objective: "Different objective" }, { inputs: ["other.md"] },
    { write_scope: ["backend/api.mjs"] }, { acceptance: ["Different acceptance"] }]) {
    assert.throws(() => f.reserve({ ...f.p, ...change }), /different scope\/definition/);
  }
  assert.throws(() => f.reserve(f.p, { ...context, id: "Q002" }), /different scope\/definition/);
  assert.throws(() => f.reserve(f.p, context, "unit-tests"), /different scope\/definition/);
  assert.equal(readRun(f.project, f.p.task_id).attempts.length, 1);
});

test("risk may rise but cannot later be lowered", t => {
  const f = fixture(t); f.reserve(); f.record("environment_failure");
  f.reserve({ ...f.p, risk: "critical", risk_reason: "Critical data integrity boundary" });
  f.record("environment_failure");
  for (const risk of ["normal", "high"]) assert.throws(() => f.reserve({ ...f.p, risk }), /lower.*risk/);
});

test("a completed pass cannot be dispatched or recorded again", t => {
  const f = fixture(t); f.reserve(); const receipt = f.receipt("pass");
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 });
  f.record("pass");
  assert.throws(() => f.reserve(), /already passed/);
  assert.throws(() => recordOutcome(f.project, f.p.task_id, receipt), /already closed/);
});

test("stale outcome and process receipts cannot close the current attempt", t => {
  const f = fixture(t); f.reserve(); const stale = f.receipt("pass");
  f.record("implementation_failure"); f.reserve();
  assert.throws(() => recordOutcome(f.project, f.p.task_id, stale), /stale/);
  assert.throws(() => recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 }), /stale/);
  assert.equal(readRun(f.project, f.p.task_id).attempts.at(-1).outcome, null);
});

test("reserve rejects a route computed before failure history changed", t => {
  const f = fixture(t); f.reserve(); f.record("implementation_failure");
  assert.throws(() => reserveRun(f.project, { packet: f.p, context, route: route(f.p),
    lock_hash: "lock", prompt_hash: "prompt", mode: "cli" }), /Failure history changed/);
});

test("runtime parsing observes thread, model, effort and recorded session usage", () => {
  const usage = { input_tokens: 123, cached_input_tokens: 40, output_tokens: 17 };
  const observed = runtimeObservation("not JSON\n" + jsonl([
    ...runtimeEvents(), { type: "token_usage_record", payload: { thread_token_usage: usage } },
  ]), "actual-thread");
  assert.equal(observed.runtime_id, "actual-thread");
  assert.equal(observed.actual_model, "gpt-6-luna");
  assert.equal(observed.actual_effort, "medium");
  assert.equal(observed.model_observation, "runtime_configuration");
  assert.equal(observed.usage_scope, "recorded_session_only_not_billing");
  assert.deepEqual(observed.usage, usage);
});

test("CLI completion usage sums turns without counting invalid token values", () => {
  const observed = runtimeObservation(jsonl([
    ...runtimeEvents(),
    { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 3, cached_input_tokens: 4 } },
    { type: "turn.completed", usage: { input_tokens: 7, output_tokens: 2, cached_input_tokens: -9, junk: "100" } },
  ]));
  assert.deepEqual(observed.usage, { input_tokens: 27, output_tokens: 5, cached_input_tokens: 4 });
});

test("runtime evidence rejects mixed sessions and a mismatched session ID", () => {
  assert.throws(() => runtimeObservation(jsonl(runtimeEvents()), "invented-thread"), /does not match/);
  assert.throws(() => runtimeObservation(jsonl([
    ...runtimeEvents(), { type: "session_meta", payload: { id: "another-thread" } },
  ])), /multiple sessions/);
  assert.throws(() => runtimeObservation(jsonl([{ type: "turn_context", payload: { model: "gpt-6-luna" } }]), "actual-thread"), /does not match/);
});

test("native receipts require an actual runtime ID and verify it against runtime evidence", t => {
  const f = fixture(t, {}, "native"); f.reserve();
  assert.throws(() => f.record("pass"), /runtime_id/);
  const log = runtimeLog(f, runtimeEvents());
  assert.throws(() => f.record("pass", { runtime_id: "made-up-thread", runtime_log: log }), /does not match/);
  const run = f.record("pass", { runtime_id: "actual-thread", runtime_log: log });
  assert.equal(run.attempts[0].runtime_id, "actual-thread");
  assert.equal(run.attempts[0].actual_model, "gpt-6-luna");
  assert.equal(run.attempts[0].runtime_evidence.sha256, createHash("sha256").update(readFileSync(join(f.project, log))).digest("hex"));
});

test("receipts cannot assert actual model or usage without runtime evidence", t => {
  const f = fixture(t); f.reserve();
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 });
  for (const fields of [{ actual_model: "gpt-6-luna" }, { usage: { input_tokens: 1 } }]) {
    assert.throws(() => f.record("pass", fields), /runtime evidence/);
  }
  assert.equal(readRun(f.project, f.p.task_id).attempts[0].outcome, null);
});

test("missing runtime evidence preserves unknown observation and usage", t => {
  const f = fixture(t, {}, "native"); f.reserve();
  const summary = runSummary(f.record("pass", { runtime_id: "reported-native-id" })).attempts[0];
  assert.equal(summary.requested_model, "gpt-6-luna");
  assert.equal(summary.actual_model, "not_observed");
  assert.equal(summary.model_observation, "not_observed");
  assert.equal(summary.usage, null);
  assert.equal(summary.usage_scope, "unknown");
});

for (const [name, events] of [
  ["model", runtimeEvents("gpt-6-astra")],
  ["effort", runtimeEvents("gpt-6-luna", "high")],
  ["mixed models", [...runtimeEvents(), { type: "turn_context", payload: { model: "gpt-6-astra", effort: "medium" } }]],
  ["mixed efforts", [...runtimeEvents(), { type: "turn_context", payload: { model: "gpt-6-luna", effort: "high" } }]],
]) test("an observed " + name + " mismatch cannot receive a compliant pass", t => {
  const f = fixture(t); f.reserve();
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 });
  const log = runtimeLog(f, events);
  assert.throws(() => f.record("pass", { runtime_id: "actual-thread", runtime_log: log }), /model|effort/i);
  assert.equal(readRun(f.project, f.p.task_id).attempts[0].outcome, null);
});

for (const [name, model, effort] of [
  ["model", "gpt-6-astra", "medium"],
  ["effort", "gpt-6-luna", "high"],
]) test("a supplemental thread-only log cannot erase a known " + name + " mismatch", t => {
  const f = fixture(t); f.reserve();
  const observation = runtimeObservation(jsonl(runtimeEvents(model, effort)));
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 0, ...observation });
  const log = runtimeLog(f, [{ type: "thread.started", thread_id: "actual-thread" }]);
  assert.throws(() => f.record("pass", { runtime_id: "actual-thread", runtime_log: log }), /model|effort/i);
  const saved = readRun(f.project, f.p.task_id).attempts[0];
  assert.equal(saved.outcome, null);
  assert.equal(saved.runtime_id, "actual-thread");
  assert.equal(saved.actual_model, model);
  assert.equal(saved.actual_effort, effort);
  assert.equal(saved.model_observation, "runtime_configuration");
  assert.deepEqual(saved.observed_models, [model]);
});

test("a pending CLI cannot pass and a successful exit still requires an evidence-based outcome", t => {
  const f = fixture(t); f.reserve();
  assert.throws(() => f.record("pass"), /pending|process|execution/i);
  assert.equal(readRun(f.project, f.p.task_id).attempts[0].outcome, null);
  const run = recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 });
  assert.equal(run.attempts[0].execution, "completed_needs_review");
  assert.equal(run.attempts[0].outcome, null);
  assert.throws(() => f.reserve(), /receipt/);
  assert.equal(f.record("pass").attempts[0].outcome, "pass");
});

test("a failed CLI process cannot pass and must be classified before retry", t => {
  const f = fixture(t); f.reserve();
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 17 });
  assert.throws(() => f.record("pass"), /Failed process/);
  assert.equal(f.record("environment_failure").attempts[0].execution, "failed_needs_classification");
  assert.equal(f.reserve().attempts.at(-1).route.failures, 0);
});

test("execution results cannot fabricate a reviewed outcome", t => {
  const f = fixture(t); f.reserve();
  assert.throws(() => recordExecution(f.project, f.p.task_id, 1, {
    exit_code: 0, outcome: "pass",
  }), /outcome|runtime|field|result/i);
  assert.equal(readRun(f.project, f.p.task_id).attempts[0].outcome, null);
});

test("a completed process receipt cannot be overwritten to erase a failed exit", t => {
  const f = fixture(t); f.reserve();
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 17 });
  assert.throws(() => recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 }), /already|execution|recorded/i);
  assert.throws(() => f.record("pass"), /Failed process/);
});

test("task IDs reject absolute paths, traversal, path separators and symlink records", t => {
  const f = fixture(t), outside = temporary(t);
  for (const id of ["../escape", "/tmp/escape", "a/b", "a\\b", ".", "..", "a\0b", "a".repeat(97)]) {
    assert.throws(() => runPath(f.project, id), /task_id/);
    assert.throws(() => reserveRun(f.project, { packet: packet({ task_id: id }), context, route: route(f.p), mode: "cli" }), /task_id/);
  }
  mkdirSync(join(f.project, ".planning/agt/model-runs"), { recursive: true });
  const protectedFile = join(outside, "run.json"); writeFileSync(protectedFile, "protected");
  symlinkSync(protectedFile, join(f.project, ".planning/agt/model-runs/linked.json"));
  assert.throws(() => readRun(f.project, "linked"), /Symlink/);
  assert.equal(readFileSync(protectedFile, "utf8"), "protected");
});

test("a symlink model-run directory cannot redirect writes outside the project", t => {
  const f = fixture(t), outside = temporary(t);
  mkdirSync(join(f.project, ".planning/agt"), { recursive: true });
  symlinkSync(outside, join(f.project, ".planning/agt/model-runs"));
  assert.throws(() => f.reserve(), /Symlink/);
  assert.deepEqual(readdirSync(outside), []);
});

test("outcome evidence must exist and remain within non-symlink project paths", t => {
  const f = fixture(t), outside = temporary(t); f.reserve();
  recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 });
  writeFileSync(join(outside, "secret.txt"), "external evidence");
  symlinkSync(join(outside, "secret.txt"), join(f.project, "linked.txt"));
  symlinkSync(outside, join(f.project, "external"));
  for (const evidence of [[], ["missing.txt"], [join(outside, "secret.txt")], ["../secret.txt"], ["linked.txt"], ["external/secret.txt"]]) {
    assert.throws(() => f.record("pass", { evidence }));
    assert.equal(readRun(f.project, f.p.task_id).attempts[0].outcome, null);
  }
  const run = f.record("pass");
  assert.equal(run.attempts[0].evidence[0].sha256,
    createHash("sha256").update(readFileSync(join(f.project, "evidence.txt"))).digest("hex"));
});

test("failure evidence retains its original bytes after the source changes and rejects a mutable run as evidence", t => {
  const f = fixture(t); f.reserve();
  const original = readFileSync(join(f.project, "evidence.txt"));
  const failed = f.record("implementation_failure").attempts[0].evidence[0];
  assert.equal(failed.snapshot, ".planning/agt/model-runs/evidence/" + failed.sha256);
  assert.deepEqual(readFileSync(join(f.project, failed.snapshot)), original);
  const updated = Buffer.from("Updated assertion output from the next attempt\n");
  writeFileSync(join(f.project, "evidence.txt"), updated);
  f.reserve();
  assert.throws(() => f.record("implementation_failure", {
    evidence: [".planning/agt/model-runs/" + f.p.task_id + ".json"],
  }), /own mutable model record/);
  assert.equal(readRun(f.project, f.p.task_id).attempts[1].outcome, null);
  const second = f.record("implementation_failure").attempts[1].evidence[0];
  assert.notEqual(second.sha256, failed.sha256);
  assert.deepEqual(readFileSync(join(f.project, failed.snapshot)), original);
  assert.deepEqual(readFileSync(join(f.project, second.snapshot)), updated);
  assert.deepEqual(readRun(f.project, f.p.task_id).attempts[0].evidence[0], failed);
});

test("dispatch and receipt operations preserve workflow, registry and policy locks", t => {
  const f = fixture(t), protectedPaths = [".planning/workflow/state.yaml", ".planning/agt/agents.yaml", "models.lock.json"];
  const snapshots = new Map(protectedPaths.map(path => {
    const full = join(f.project, path); mkdirSync(resolve(full, ".."), { recursive: true });
    const bytes = Buffer.from("protected artifact " + path + "\n"); writeFileSync(full, bytes); return [full, bytes];
  }));
  f.reserve(); recordExecution(f.project, f.p.task_id, 1, { exit_code: 0 }); f.record("pass");
  runSummary(readRun(f.project, f.p.task_id));
  for (const [path, bytes] of snapshots) assert.deepEqual(readFileSync(path), bytes);
  assert.deepEqual(readdirSync(join(f.project, ".planning/agt/model-runs")).sort(), ["evidence", f.p.task_id + ".json"].sort());
});
