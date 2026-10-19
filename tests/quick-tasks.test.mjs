import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as q from "../adapters/quick/quick-tasks.mjs";

function write(root, path, value) {
  mkdirSync(resolve(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
}
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "agt-quick-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Quick Test");
  git(root, "config", "user.email", "quick@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  write(root, ".planning/agt/quick-tasks.json", { schema_version: 1, enabled: true, adoption_source: "User requested bounded tasks" });
  write(root, ".planning/agt/project.yaml", "profile: consumer-ai-web@2.0.0\n");
  write(root, ".planning/workflow/state.yaml", "milestone: M002\nstage: milestone-complete\nstatus: complete\nactive_role: null\nlast_transition: TRANSITION-M002-146\n");
  write(root, ".planning/agt/agents.yaml", "agents: []\n");
  write(root, ".planning/workflow/history.yaml", "history: frozen\n");
  write(root, "app.txt", "before\n");
  write(root, "policy.md", "approved scope\n");
  git(root, "add", "."); git(root, "commit", "-m", "fixture");
  return root;
}
function spec(extra = {}) {
  const document_impacts = Object.fromEntries(["product", "design", "technical", "verification", "handoff"].map(k => [k, { status: "none", reason: "Isolated fixture has no changed contract or canonical report in this domain" }]));
  return { slug: "fix-label", title: "Fix a bounded label", request: "User: fix the label", executor: "current session", milestone: "M002", sources: ["policy.md"], write_scope: ["app.txt"], plan: ["Fix the label", "Verify the result"], acceptance: [{ id: "AC1", description: "Label is corrected", verification: "command" }], document_impacts, document_tasks: [], ...extra };
}
const checks = (code = "process.exit(0)") => [{ criteria: ["AC1"], argv: [process.execPath, "-e", code] }];
function start(root, value = spec()) {
  const task = q.create(root, value);
  q.change(root, task.id, "start");
  return task.id;
}

function closeout(root, id, outcome = "Scoped fixture completed") {
  const task = q.show(root, id);
  return { outcome, rationale: "Applied the requested label correction within the approved scope",
    verification_scope: "AC1 targeted fixture verification; no production deployment or broad UI claim",
    limitations: "Only the isolated fixture was exercised; no independent agent trial",
    decisions: [{ summary: "Use the behavior explicitly requested by the user", source: "task.request" }], retained_items: [],
    documents: task.document_tasks.map(d => ({ document: d.id, disposition: "already_concise", summary: "Inspected the canonical current definition; no repeated rounds or obsolete next actions remain" })) };
}
function finish(root, id, summary) {
  q.compact(root, id, closeout(root, id, summary));
  return q.change(root, id, "finish");
}

test("closed milestone supports create, execute, verify and finish without global state or Git changes", t => {
  const root = fixture(t), head = git(root, "rev-parse", "HEAD");
  const controls = [".planning/agt/project.yaml", ".planning/workflow/state.yaml", ".planning/agt/agents.yaml", ".planning/workflow/history.yaml"];
  const original = controls.map(p => readFileSync(join(root, p), "utf8"));
  write(root, "unrelated-draft.md", "user work");
  const id = start(root);
  write(root, "app.txt", "after\n");
  q.verify(root, id, checks("const fs=require('node:fs');if(fs.readFileSync('app.txt','utf8')!=='after\\n')process.exit(1)"));
  const result = finish(root, id, "Label corrected; targeted check passed");
  assert.equal(result.status, "complete");
  assert.equal(q.show(root, id, { history: true }).validation_now[0].pass, true);
  assert.equal(q.list(root)[0].status, "complete");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.deepEqual(controls.map(p => readFileSync(join(root, p), "utf8")), original);
  assert.equal(readFileSync(join(root, "unrelated-draft.md"), "utf8"), "user work");
  assert.throws(() => q.change(root, id, "start"), /immutable/);
  assert.equal(existsSync(join(root, ".planning/milestones/M003")), false);
});

test("failed checks cannot be hidden by a later passing command in the same batch", t => {
  const root = fixture(t), id = start(root);
  assert.throws(() => q.verify(root, id, [...checks("process.exit(3)"), ...checks()]), /Checks failed/);
  assert.equal(q.show(root, id, { history: true }).checks[0].status, "fail");
  assert.throws(() => q.change(root, id, "finish", { summary: "incorrect" }), /Unverified/);
  q.verify(root, id, checks());
  assert.equal(q.show(root, id, { history: true }).checks[0].status, "fail");
  finish(root, id, "Required check rerun successfully");
});

test("code, source, plan and evidence changes invalidate prior checks", t => {
  const root = fixture(t), id = start(root);
  q.verify(root, id, checks());
  write(root, "app.txt", "changed after test");
  assert.throws(() => q.change(root, id, "finish", { summary: "stale" }), /stale/);
  q.verify(root, id, checks());
  write(root, "policy.md", "new constraint");
  assert.equal(q.show(root, id, { history: true }).validation_now[0].pass, false);
  q.verify(root, id, checks());
  q.change(root, id, "revise", { spec: spec({ plan: ["Revised plan"] }), reason: "User clarified the behavior" });
  q.change(root, id, "start");
  assert.throws(() => q.change(root, id, "finish", { summary: "old plan" }), /stale/);
  q.verify(root, id, checks());
  const record = q.show(root, id, { history: true }), log = record.checks.at(-1).evidence[0].path;
  write(root, log, "tampered log");
  assert.throws(() => q.change(root, id, "finish", { summary: "tampered" }), /stale/);
});

test("manual acceptance cannot be replaced by a command or missing/not-run evidence", t => {
  const root = fixture(t), id = start(root, spec({ acceptance: [
    ...spec().acceptance, { id: "AC2", description: "User observes intended result", verification: "manual" },
  ] }));
  q.verify(root, id, checks());
  assert.throws(() => q.verify(root, id, [{ ...checks()[0], criteria: ["AC2"] }]), /method mismatch/);
  assert.throws(() => q.change(root, id, "finish", { summary: "incomplete" }), /AC2/);
  const observation = { criteria: ["AC2"], method: "manual", status: "pass", summary: "Actual user observation", evidence: ["acceptance.md"] };
  assert.throws(() => q.observe(root, id, [observation]), /Missing evidence/);
  write(root, "acceptance.md", "User accepted only this task.");
  q.observe(root, id, [{ ...observation, status: "not_run" }]);
  assert.throws(() => q.change(root, id, "finish", { summary: "not observed" }), /AC2/);
  q.observe(root, id, [observation]);
  finish(root, id, "Targeted command and user observation recorded");
});

test("read-only recovery preserves blocked status and rejects writes on another branch", t => {
  const root = fixture(t), id = start(root);
  q.change(root, id, "block", { reason: "Need the user's label choice" });
  const file = join(root, `.planning/quick/${id}/task.json`), before = readFileSync(file, "utf8");
  q.show(root, id, { history: true }); q.list(root);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.throws(() => q.change(root, id, "start"), /blocker/);
  git(root, "switch", "-c", "other");
  assert.equal(q.show(root, id, { history: true }).branch, "main");
  assert.throws(() => q.change(root, id, "start", { reason: "choice received" }), /belongs to branch/);
  git(root, "switch", "main");
  q.change(root, id, "start", { reason: "User supplied the label choice" });
  q.change(root, id, "escalate", { reason: "New business decision needed", target: "Existing product decision" });
  assert.equal(q.show(root, id, { history: true }).status, "escalated");
  assert.throws(() => q.change(root, id, "start"), /immutable/);
});

test("interrupted work has a concrete checkpoint and revised plans preserve prior scope", t => {
  const root = fixture(t), id = start(root);
  write(root, "app.txt", "partially fixed");
  q.change(root, id, "checkpoint", { summary: "Cause identified and label updated; verification pending", next: "Run the label behavior regression" });
  const record = q.show(root, id, { history: true });
  assert.equal(record.status, "active");
  assert.equal(record.next_action, "Run the label behavior regression");
  assert.match(record.progress, /verification pending/);
  q.change(root, id, "revise", { reason: "User clarified acceptance", spec: spec({ plan: ["Use clarified label", "Verify"] }) });
  const revised = q.show(root, id, { history: true });
  assert.deepEqual(revised.events.at(-1).previous_plan.plan, spec().plan);
  assert.equal(revised.events.at(-1).previous_plan.progress, record.progress);
  assert.equal(revised.progress, null);
  assert.equal(revised.status, "planned");
});

test("inputs reject unsafe paths, control scope, missing adoption and duplicate tasks", t => {
  const root = fixture(t);
  for (const path of ["../escape", "/tmp/escape", ".git/config", ".planning/workflow/state.yaml", ".planning/quick/Q001-x/task.json", ".planning/agt/project.yaml", ".planning/agt/quick-tasks.json"]) assert.throws(() => q.create(root, spec({ write_scope: [path] })));
  symlinkSync(tmpdir(), join(root, "outside"));
  assert.throws(() => q.create(root, spec({ write_scope: ["outside/new.txt"] })), /Symlink/);
  assert.throws(() => q.create(root, spec({ sources: [".planning"] })), /source file/);
  assert.throws(() => q.create(root, spec({ slug: "../bad" })), /slug/);
  const a = q.create(root, spec());
  assert.throws(() => q.create(root, spec()), /unfinished/);
  q.change(root, a.id, "cancel", { reason: "User cancelled this task" });
  assert.match(q.create(root, spec()).id, /^Q002-/);
  write(root, ".planning/agt/quick-tasks.json", { schema_version: 1, enabled: false });
  assert.throws(() => q.create(root, spec()), /adoption/);
});

test("checks that modify inputs fail; execution errors and timeout preserve evidence", t => {
  const root = fixture(t), id = start(root);
  assert.throws(() => q.verify(root, id, checks("require('node:fs').writeFileSync('app.txt','modified by check')")), /inputs changed/);
  assert.throws(() => q.verify(root, id, [{ criteria: ["AC1"], argv: ["agt-no-such-executable"] }]), /Checks failed/);
  assert.throws(() => q.verify(root, id, [{ ...checks("setTimeout(()=>{},10000)")[0], timeout_ms: 20 }]), /Checks failed/);
  assert.equal(q.show(root, id, { history: true }).checks.length, 3);
  assert.equal(q.show(root, id, { history: true }).checks.every(c => c.status === "fail"), true);
  assert.throws(() => q.change(root, id, "finish", { summary: "incorrect" }), /Unverified/);
});

test("workstream bindings and live writer locks cannot be bypassed", t => {
  const root = fixture(t), id = start(root);
  write(root, ".planning/agt/workstreams.json", { mode: "workstreams" });
  assert.throws(() => q.change(root, id, "block", { reason: "test" }), /workstreams/);
  assert.equal(q.list(root).length, 1);
  rmSync(join(root, ".planning/agt/workstreams.json"));
  git(root, "switch", "-c", "agt/M002/feature");
  assert.throws(() => q.create(root, spec({ slug: "other" })), /binding/);
  git(root, "switch", "main");
  const lock = join(root, ".git/agt-quick.lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  assert.throws(() => q.change(root, id, "block", { reason: "test" }), /locked/);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).pid, process.pid);
});

test("document-only inspection can finish without application tests and remains inspectable after source removal", t => {
  const root = fixture(t), id = start(root, spec({ acceptance: [{ id: "AC1", description: "Copy matches approved wording", verification: "inspection" }] }));
  q.observe(root, id, [{ criteria: ["AC1"], method: "inspection", status: "pass", summary: "Compared wording to approved source", evidence: ["app.txt", "policy.md"] }]);
  finish(root, id, "Copy checked; application tests unnecessary for this change");
  rmSync(join(root, "policy.md"));
  assert.equal(q.show(root, id, { history: true }).status, "complete");
  assert.equal(q.show(root, id, { history: true }).validation_now[0].pass, false);
});

test("CLI validates arguments and argv values are not evaluated by a shell", t => {
  const root = fixture(t), cli = resolve("adapters/quick/agt-quick.mjs");
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run(["create", "--project", root]).status, 1);
  assert.equal(run(["unknown", "--project", root]).status, 1);
  const id = start(root);
  const payload = "$(touch SHOULD_NOT_EXIST); `touch ALSO_NOT_EXIST`";
  assert.equal(run(["validate", "--project", root, "--id", id]).status, 1);
  q.verify(root, id, [{ criteria: ["AC1"], argv: [process.execPath, "-e", "process.stdout.write(process.argv[1])", payload] }]);
  assert.equal(run(["validate", "--project", root, "--id", id]).status, 1);
  q.compact(root, id, closeout(root, id));
  assert.equal(run(["validate", "--project", root, "--id", id]).status, 0);
  assert.equal(existsSync(join(root, "SHOULD_NOT_EXIST")), false);
  assert.equal(existsSync(join(root, "ALSO_NOT_EXIST")), false);
  assert.equal(JSON.parse(run(["resume", "--project", root, "--id", id]).stdout).status, "active");
});

function documentSpec(domains = ["product", "design", "technical", "verification", "handoff"]) {
  const roles = { product: "product/to-c", design: "uiux/base", technical: "backend-architect/base", verification: "quality/base", handoff: "frontend-implementer/base" };
  const value = spec();
  value.document_tasks = domains.map((domain, i) => ({ id: `DOC${i + 1}`, domain, role: roles[domain], paths: [`docs/${domain}.md`], change: `Update canonical ${domain} definition for this task`, depends_on: i ? [`DOC${i}`] : [], approval_required: domain === "product", approval_source: domain === "product" ? "task.request" : null }));
  for (const domain of domains) value.document_impacts[domain] = { status: "affected", reason: `Confirmed request changes the ${domain} source` };
  value.write_scope.push(...value.document_tasks.flatMap(d => d.paths));
  return value;
}
function prepareDocuments(root, value, commit = false) {
  for (const d of value.document_tasks) for (const path of d.paths) write(root, path, `original ${d.domain}\n`);
  if (commit) { git(root, "add", "docs"); git(root, "commit", "-m", "canonical document baseline"); }
}
function reconcile(root, id, d) {
  return q.reconcile(root, id, { document: d, status: "pass", executor: "current session", mode: "serial", summary: "Updated canonical content and checked downstream impact", evidence: [] });
}

test("product/design/technical changes flow into canonical groups before QA and handoff; milestone stays closed", t => {
  const root = fixture(t), value = documentSpec();
  prepareDocuments(root, value, true);
  const state = readFileSync(join(root, ".planning/workflow/state.yaml"), "utf8"), id = start(root, value);
  assert.throws(() => q.verify(root, id, checks()), /Upstream document/);
  for (const d of value.document_tasks.slice(0, 3)) {
    const packet = q.dispatch(root, id, d.id);
    assert.equal(packet.role, d.role);
    assert.deepEqual(packet.write_scope, d.paths);
    assert.ok(existsSync(resolve(packet.role_definition)));
    assert.equal(packet.dependencies.every(x => x.pass), true);
    write(root, d.paths[0], `Current ${d.domain}; new requirement Q ${id}; original acceptance remains versioned\n`);
    reconcile(root, id, d.id);
  }
  write(root, "app.txt", "implemented against current definitions");
  q.verify(root, id, checks());
  assert.throws(() => q.change(root, id, "finish", { summary: "code only" }), /Document reconciliation/);
  for (const d of value.document_tasks.slice(3)) {
    write(root, d.paths[0], `Current ${d.domain}; tested behavior and retained boundaries\n`);
    reconcile(root, id, d.id);
  }
  const result = q.show(root, id, { history: true });
  assert.equal(result.validation_now[0].pass, true, "Writing QA results must not require rerunning unchanged code");
  assert.equal(result.checks.length, 1);
  assert.equal(result.documents_now.every(d => d.pass), true);
  assert.equal(result.document_baselines.every(b => b.original.git_revision && !b.original.snapshot), true);
  finish(root, id, "Behavior and all affected canonical groups reconciled");
  assert.equal(readFileSync(join(root, ".planning/workflow/state.yaml"), "utf8"), state);
});

test("a task summary or passing tests cannot replace an actual QA document writeback", t => {
  const root = fixture(t), value = documentSpec(["verification"]);
  prepareDocuments(root, value);
  const id = start(root, value);
  q.verify(root, id, checks());
  q.change(root, id, "checkpoint", { summary: "Pretend documentation is done", next: "Finish" });
  assert.throws(() => reconcile(root, id, "DOC1"), /Canonical documents/);
  assert.throws(() => q.change(root, id, "finish", { summary: "all done" }), /Document reconciliation/);
  const baseline = q.show(root, id, { history: true }).document_baselines[0];
  assert.equal(readFileSync(join(root, baseline.original.snapshot), "utf8"), "original verification\n");
  write(root, "docs/verification.md", "Actual current QA results\n");
  reconcile(root, id, "DOC1");
  finish(root, id, "QA current document updated");
});

test("an upstream change invalidates dependent owners; code changes invalidate QA owner receipts", t => {
  const root = fixture(t), value = documentSpec(["product", "design", "verification"]);
  prepareDocuments(root, value);
  const id = start(root, value);
  for (const d of value.document_tasks) { write(root, d.paths[0], `updated ${d.id}`); reconcile(root, id, d.id); }
  q.verify(root, id, checks());
  write(root, "docs/product.md", "changed product decision");
  reconcile(root, id, "DOC1");
  assert.equal(q.show(root, id, { history: true }).documents_now.find(d => d.id === "DOC2").pass, false);
  assert.throws(() => reconcile(root, id, "DOC3"), /Upstream document owner/);
  assert.throws(() => q.verify(root, id, checks()), /Upstream document/);
  reconcile(root, id, "DOC2"); reconcile(root, id, "DOC3");
  write(root, "app.txt", "new implementation");
  const status = q.show(root, id, { history: true }).documents_now;
  assert.equal(status.find(d => d.id === "DOC1").pass, true);
  assert.equal(status.find(d => d.id === "DOC3").pass, false);
});

test("new product decisions need a source and changing the source invalidates reconciliation", t => {
  const root = fixture(t), value = documentSpec(["product"]);
  value.document_tasks[0].approval_source = null;
  prepareDocuments(root, value);
  const id = start(root, value);
  write(root, "docs/product.md", "Proposed new behavior");
  assert.throws(() => reconcile(root, id, "DOC1"), /approval source is missing/);
  write(root, "user-decision.md", "User explicitly approves this changed behavior");
  value.document_tasks[0].approval_source = "user-decision.md";
  q.change(root, id, "revise", { reason: "User supplied the decision", spec: value });
  q.change(root, id, "start"); reconcile(root, id, "DOC1"); q.verify(root, id, checks());
  write(root, "user-decision.md", "User corrected the previous decision");
  assert.equal(q.show(root, id, { history: true }).documents_now[0].pass, false);
  assert.equal(q.show(root, id, { history: true }).validation_now[0].pass, false);
});

test("document responsibility cannot be omitted, assigned to the wrong role, or bypass upstream dependencies", t => {
  const root = fixture(t);
  assert.throws(() => q.create(root, spec({ document_impacts: undefined })), /assessment/);
  const value = documentSpec(["product", "design"]); prepareDocuments(root, value);
  assert.throws(() => q.create(root, { ...value, document_tasks: [] }), /routing/);
  const wrong = structuredClone(value); wrong.document_tasks[0].role = "quality/base";
  assert.throws(() => q.create(root, wrong), /role\/domain/);
  const skipped = structuredClone(value); skipped.document_tasks[1].depends_on = [];
  assert.throws(() => q.create(root, skipped), /upstream documents/);
  const cycle = structuredClone(value); cycle.document_tasks[0].depends_on = ["DOC2"];
  assert.throws(() => q.create(root, cycle), /cycle/);
  const frozen = documentSpec(["product"]); frozen.document_tasks[0].paths = ["reviews/accepted.md"]; frozen.write_scope.push("reviews/accepted.md");
  assert.throws(() => q.create(root, frozen), /frozen approvals/);
});

test("delegated authoring records actual routing metadata without claiming independent verification", t => {
  const root = fixture(t), value = documentSpec(["verification"]); prepareDocuments(root, value);
  value.request = "User explicitly requests a QA agent to author the current report";
  const id = start(root, value);
  write(root, "docs/verification.md", "QA owner authored current report");
  const receipt = { document: "DOC1", status: "pass", executor: "qa-quinn", mode: "delegated", summary: "Fixture authoring result", evidence: [] };
  assert.throws(() => q.reconcile(root, id, { ...receipt, status: "blocked" }), /explicitly completed/);
  assert.throws(() => q.reconcile(root, id, receipt), /runtime ID and authorization/);
  assert.throws(() => q.reconcile(root, id, { ...receipt, mode: "serial" }), /actual task executor/);
  assert.throws(() => q.reconcile(root, id, { ...receipt, executor: "runtime-1234", runtime_id: "fixture", authorization_source: "task.request" }), /semantic name/);
  q.reconcile(root, id, { ...receipt, runtime_id: "fixture-runtime", authorization_source: "task.request" });
  const saved = q.show(root, id, { history: true }).document_receipts[0];
  assert.equal(saved.role, "quality/base");
  assert.equal(saved.independent_review, false);
  const cli = spawnSync(process.execPath, [resolve("adapters/quick/agt-quick.mjs"), "dispatch", "--project", root, "--id", id, "--document", "DOC1"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).role_definition, "roles/quality/base.md");
});

test("finish requires semantic context closeout, document coverage and sourced retained items", t => {
  const root = fixture(t), value = documentSpec(["verification"]); prepareDocuments(root, value);
  const id = start(root, value);
  q.verify(root, id, checks());
  write(root, "docs/verification.md", "AC1 passed for current fixture; browser validation not run; evidence is in the Q task.\n");
  reconcile(root, id, "DOC1");
  assert.throws(() => q.change(root, id, "finish", { summary: "done" }), /context_compaction_missing/);
  const input = closeout(root, id);
  assert.throws(() => q.compact(root, id, { outcome: "summary only" }), /requires outcome/);
  assert.throws(() => q.compact(root, id, { ...input, documents: [] }), /every affected document/);
  assert.throws(() => q.compact(root, id, { ...input, documents: [{ document: "DOC1", disposition: "zipped", summary: "packed" }] }), /disposition/);
  assert.throws(() => q.compact(root, id, { ...input, retained_items: [{ id: "TODO1", summary: "unverified" }] }), /stable ID/);
  assert.throws(() => q.compact(root, id, { ...input, decisions: [{ summary: "approved", source: "missing-decision.md" }] }), /Missing evidence/);
  q.compact(root, id, input);
  assert.equal(q.show(root, id).compaction_now.independent_recovery, "not_run");
  assert.throws(() => q.change(root, id, "finish", { summary: "Different unreviewed result" }), /must match/);
  q.change(root, id, "finish");
  assert.equal(q.show(root, id).summary, input.outcome);
});

test("default recovery excludes superseded plans and historical checks while preserving constraints and evidence routes", t => {
  const root = fixture(t);
  const id = start(root, spec({ plan: ["SUPERSEDED_PLAN " + "old reasoning ".repeat(1500)] }));
  assert.throws(() => q.verify(root, id, checks("console.log('ORIGINAL_FAILURE'); process.exit(2)")), /Checks failed/);
  q.change(root, id, "revise", { reason: "Confirmed final scope", spec: spec() }); q.change(root, id, "start");
  q.verify(root, id, checks());
  write(root, "retained.md", "PRON-1: separate production audio environment remains unverified; no release approval.");
  const input = closeout(root, id);
  input.retained_items = [{ id: "PRON-1", summary: "Production audio environment unverified", next_action: "Verify the production environment under a separate authorized scope", evidence: ["retained.md"] }];
  q.compact(root, id, input); q.change(root, id, "finish");
  const view = q.show(root, id), history = q.show(root, id, { history: true });
  assert.equal(view.status, "complete"); assert.equal(view.next_action, null);
  assert.equal(view.context.retained_items[0].id, "PRON-1");
  assert.equal(view.context.decisions[0].source, "task.request");
  assert.equal(view.context.limitations, input.limitations);
  for (const key of ["events", "checks", "document_receipts", "document_baselines", "plan", "progress"]) assert.equal(Object.hasOwn(view, key), false, key);
  assert.equal(history.checks[0].status, "fail");
  assert.match(history.events.find(e => e.action === "revise").previous_plan.plan[0], /SUPERSEDED_PLAN/);
  const originalLog = JSON.parse(readFileSync(join(root, history.checks[0].evidence[0].path), "utf8"));
  assert.match(originalLog.results[0].stdout, /ORIGINAL_FAILURE/);
  assert.ok(existsSync(join(root, view.current_checks[0].evidence[0].path)));
  const briefBytes = Buffer.byteLength(JSON.stringify(view)), fullBytes = Buffer.byteLength(JSON.stringify(history));
  assert.ok(briefBytes < fullBytes / 2, `${briefBytes} vs ${fullBytes}`);
  t.diagnostic(`Fixture JSON only: default recovery ${briefBytes} bytes; full task history ${fullBytes} bytes. Not runtime token savings.`);
  const cli = resolve("adapters/quick/agt-quick.mjs");
  for (const command of ["show", "resume"]) {
    const result = spawnSync(process.execPath, [cli, command, "--project", root, "--id", id], { encoding: "utf8" });
    assert.equal(result.status, 0); assert.equal(Object.hasOwn(JSON.parse(result.stdout), "checks"), false);
  }
  const expanded = spawnSync(process.execPath, [cli, "show", "--project", root, "--id", id, "--history"], { encoding: "utf8" });
  assert.equal(JSON.parse(expanded.stdout).checks[0].status, "fail");
});

test("repeated compaction is byte-idempotent and preserves superseded observation evidence", t => {
  const root = fixture(t), id = start(root, spec({ acceptance: [{ id: "AC1", description: "Observe actual current wording", verification: "inspection" }] }));
  const observation = { criteria: ["AC1"], method: "inspection", summary: "Compared actual wording", evidence: ["app.txt"] };
  q.observe(root, id, [{ ...observation, status: "fail" }]);
  write(root, "app.txt", "corrected wording");
  q.observe(root, id, [{ ...observation, status: "pass" }]);
  const input = closeout(root, id); q.compact(root, id, input);
  const taskPath = join(root, `.planning/quick/${id}/task.json`), before = readFileSync(taskPath);
  const files = () => spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).stdout;
  const initialFiles = files(); q.compact(root, id, input);
  assert.deepEqual(readFileSync(taskPath), before); assert.equal(files(), initialFiles);
  const original = q.show(root, id, { history: true }).checks[0].evidence[0].original;
  assert.equal(readFileSync(join(root, original.snapshot), "utf8"), "before\n");
  assert.equal(q.show(root, id).compaction_now.pass, true);
  write(root, original.snapshot, "damaged historical observation");
  assert.equal(q.show(root, id).validation_now[0].pass, true);
  assert.equal(q.show(root, id).compaction_now.reason, "historical_original_missing_or_changed");
  assert.throws(() => q.change(root, id, "finish"), /Historical|historical/);
});

test("code, evidence, plan, retained sources and renewed checks invalidate context closeout", t => {
  const root = fixture(t), id = start(root);
  q.verify(root, id, checks());
  write(root, "decision.md", "approved bounded label");
  const input = closeout(root, id); input.decisions.push({ summary: "Retain the approved wording", source: "decision.md" });
  q.compact(root, id, input);
  write(root, "decision.md", "changed decision");
  assert.equal(q.show(root, id).compaction_now.reason, "context_compaction_stale");
  q.compact(root, id, input);
  write(root, "app.txt", "new implementation"); q.verify(root, id, checks());
  assert.equal(q.show(root, id).validation_now[0].pass, true);
  assert.throws(() => q.change(root, id, "finish"), /context_compaction_stale/);
  q.compact(root, id, input);
  q.change(root, id, "checkpoint", { summary: "Further review identified a new boundary", next: "Review it" });
  assert.equal(q.show(root, id).compaction_now.pass, false);
  q.compact(root, id, input);
  q.change(root, id, "revise", { reason: "Narrowed acceptance", spec: spec({ plan: ["Updated bounded plan"] }) });
  q.change(root, id, "start"); q.verify(root, id, checks());
  assert.equal(q.show(root, id).compaction_now.pass, false);
  q.compact(root, id, input); q.change(root, id, "finish");
});

test("canonical cleanup follows owner reconciliation and corrupted document originals block archive closure", t => {
  const root = fixture(t), value = documentSpec(["verification"]); prepareDocuments(root, value);
  const id = start(root, value); q.verify(root, id, checks());
  write(root, "docs/verification.md", "round 1 pending; round 2 pass; obsolete next step: rerun everything");
  reconcile(root, id, "DOC1");
  write(root, "docs/verification.md", "AC1 PASS on fixture; limitations: no browser trial; command and failed attempt in task history.");
  assert.throws(() => q.compact(root, id, closeout(root, id)), /Reconcile all/);
  reconcile(root, id, "DOC1");
  const input = closeout(root, id); input.documents[0] = { document: "DOC1", disposition: "consolidated", summary: "Merged rounds into current AC1 result; removed obsolete rerun instruction; kept limitation and original evidence location" };
  q.compact(root, id, input);
  assert.equal(q.show(root, id, { history: true }).checks.length, 1, "Reporting cleanup must not rerun unchanged app checks");
  const original = q.show(root, id, { history: true }).document_baselines[0].original;
  write(root, original.snapshot, "lost original");
  assert.equal(q.show(root, id).documents_now[0].pass, true);
  assert.throws(() => q.change(root, id, "finish"), /historical_original/);
});

test("independent recovery is never inferred from static checks and actual failed recovery blocks finish", t => {
  const root = fixture(t), id = start(root); q.verify(root, id, checks());
  const input = closeout(root, id);
  assert.throws(() => q.compact(root, id, { ...input, recovery_check: { status: "pass" } }), /actual independent/);
  write(root, "recovery-evidence.md", "Fixture of an independent session: unresolved item was not discoverable");
  const recovery_check = { status: "fail", executor: "fixture-independent-reader", runtime_id: "fixture-runtime", authorization_source: "task.request", summary: "Fixture only: recovery omitted retained item", evidence: ["recovery-evidence.md"] };
  q.compact(root, id, { ...input, recovery_check });
  assert.equal(q.show(root, id).compaction_now.static_integrity, "pass");
  assert.throws(() => q.change(root, id, "finish"), /recovery_check_failed/);
  assert.throws(() => q.compact(root, id, input), /cannot be replaced by NOT_RUN/);
  write(root, "recovery-evidence.md", "Fixture of rerun: status, regression route and unverified boundary found");
  q.compact(root, id, { ...input, recovery_check: { ...recovery_check, status: "pass", summary: "Fixture rerun found required facts" } });
  q.change(root, id, "finish");
});

test("retained IDs cannot disappear without an evidenced disposition; CLI mutations also stay concise", t => {
  const root = fixture(t), id = start(root); q.verify(root, id, checks());
  write(root, "pending.md", "FOLLOWUP-1: out-of-scope browser review remains pending");
  const input = closeout(root, id);
  input.retained_items = [{ id: "FOLLOWUP-1", summary: "Browser review pending outside this fixture", next_action: "Review under its authorized follow-up", evidence: ["pending.md"] }];
  q.compact(root, id, input);
  assert.throws(() => q.compact(root, id, { ...input, retained_items: [] }), /explicit evidenced disposition/);
  write(root, "followup-resolution.md", "Fixture: user cancelled the separate browser review; it remains untested");
  const final = { ...input, retained_items: [], resolved_items: [{ id: "FOLLOWUP-1", disposition: "cancelled", summary: "Fixture cancellation; no claim of browser verification", evidence: ["followup-resolution.md"] }] };
  write(root, "closeout-input.json", final);
  const cli = resolve("adapters/quick/agt-quick.mjs");
  const result = spawnSync(process.execPath, [cli, "compact", "--project", root, "--id", id, "--input", join(root, "closeout-input.json")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const view = JSON.parse(result.stdout);
  assert.equal(Object.hasOwn(view, "checks"), false);
  assert.equal(view.context.resolved_items[0].id, "FOLLOWUP-1");
  const closed = spawnSync(process.execPath, [cli, "finish", "--project", root, "--id", id], { encoding: "utf8" });
  assert.equal(closed.status, 0, closed.stderr);
  assert.equal(JSON.parse(closed.stdout).status, "complete");
  assert.equal(Object.hasOwn(JSON.parse(closed.stdout), "events"), false);
});
