import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { git } from "../adapters/workstreams/context.mjs";
import * as d from "../adapters/delivery/delivery.mjs";
import * as quick from "../adapters/quick/quick-tasks.mjs";
function write(root, path, value) { const p = join(root, path); mkdirSync(resolve(p, ".."), { recursive: true }); writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value)); }
function commit(root) { git(root, ["add", "--", "."]); git(root, ["commit", "-m", "fixture change"]); return git(root, ["rev-parse", "HEAD"]); }
function fixture(t, adopt = true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agt-delivery-"))), root = join(dir, "product"); mkdirSync(root);
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  git(root, ["init", "-b", "main"]); git(root, ["config", "user.name", "Delivery Fixture"]); git(root, ["config", "user.email", "fixture@example.invalid"]); git(root, ["config", "commit.gpgsign", "false"]);
  write(root, "app.txt", "base\n"); write(root, "docs/operations/deployment.md", "Unconfigured; fixture only.\n");
  write(root, ".planning/agt/project.yaml", "project: fixture\n"); write(root, ".planning/workflow/state.yaml", "milestone: M001\nstage: milestone-complete\n"); commit(root);
  const config = { schema_version: 2, planning_storage: "branch", adoption_source: "User approved semantic closeout", deployment_document: "docs/operations/deployment.md" };
  if (adopt) { d.initialize(root, config); commit(root); }
  return { root, dir, config };
}
function review(root, id, disposition = "current") {
  return d.review(root, id, { reviewer: "delivery-jordan", outcome: "Current behavior delivered", verification: "Final scoped checks", limitations: "Fixture; no deployment", retained_items: [], materials: d.inventory(root, id).filter(f => f.path !== `${d.unitRoot(id)}/task.json`).map(f => ({ path: f.path, disposition, reason: "Current final content" })) });
}
function ready(root, dir, id = "M001", predecessor) {
  const start = d.start(root, { id, path: join(dir, id), approval: "User start", predecessor });
  const path = start.worktree, unit = d.unitRoot(id);
  write(path, `${unit}/product/current.md`, "Current required behavior\n"); write(path, `${unit}/verification/report.md`, "Current implementation verified\n");
  write(path, `${unit}/reviews/final.md`, "User accepted scoped final behavior\n"); write(path, "app.txt", `delivered ${id}\n`); commit(path);
  review(path, id); d.seal(path, id, { status: "accepted", kind: id.startsWith("M") ? "milestone" : "quick", approval: `${unit}/reviews/final.md` }, { required: [`${unit}/reviews/final.md`, `${unit}/verification/report.md`] }); commit(path); return path;
}
function deliver(root, id) {
  const candidate = d.prepare(root, { id });
  d.verify(root, { id, reviewer: "qa-quinn", approval: "Accepted final candidate", commands: [[process.execPath, "-e", "if(!require('node:fs').readFileSync('app.txt','utf8').startsWith('delivered'))process.exit(1)"]] });
  return { candidate, result: d.finish(root, { id }) };
}
test("adoption keeps tracked planning and only accepts the new explicit policy", t => {
  const { root, config } = fixture(t, false), before = readFileSync(join(root, ".planning/workflow/state.yaml"));
  assert.throws(() => d.initialize(root, { ...config, schema_version: 1, planning_storage: "local" }), /schema_version 2/);
  d.initialize(root, config); assert.deepEqual(readFileSync(join(root, ".planning/workflow/state.yaml")), before);
  assert.equal(git(root, ["check-ignore", "--no-index", ".planning/workflow/state.yaml"], true), null); assert.equal(d.policy(root).main_branch, "main");
  assert.throws(() => d.initialize(root, config), /already initialized/);
});
test("closeout rejects unknown/stale materials and retains plain final documents without archives", t => {
  const { root, dir } = fixture(t), id = "M001", start = d.start(root, { id, path: join(dir, id), approval: "User start" }), unit = d.unitRoot(id);
  write(start.worktree, `${unit}/final.md`, "Final result"); commit(start.worktree);
  review(start.worktree, id, "unknown"); assert.throws(() => d.seal(start.worktree, id, {}), /Unclassified/);
  review(start.worktree, id); write(start.worktree, `${unit}/final.md`, "Changed result"); assert.throws(() => d.assertReviewed(start.worktree, id), /Material changed/);
  review(start.worktree, id); write(start.worktree, "app.txt", "changed code"); assert.throws(() => d.assertReviewed(start.worktree, id), /Working code/);
  review(start.worktree, id); assert.throws(() => d.seal(start.worktree, id, {}, { required: [`${unit}/removed-failure.log`] }), /Required current evidence/);
  const result = d.seal(start.worktree, id, { status: "accepted" }, { required: [`${unit}/final.md`] });
  assert.equal(existsSync(join(start.worktree, result.path, "archive.json.gz")), false); assert.equal(d.validateSummary(start.worktree, id).summary.materials.some(m => m.path.endsWith("final.md")), true);
  commit(start.worktree); assert.equal(d.checkGit(start.worktree).pass, true); assert.throws(() => d.extract(start.worktree, id, join(dir, "unneeded")), /no archive/);
});
test("final squash excludes process commits and freezes scope; successor inherits completed baseline", t => {
  const { root, dir } = fixture(t), id = "M001", path = ready(root, dir, id), baseline = git(root, ["rev-parse", "main"]), unit = d.unitRoot(id);
  git(path, ["config", "core.quotePath", "true"]);
  const unicode = `${unit}/design/添加通用模型-UI示意.html`;
  write(path, unicode, "Current reviewed design\n");
  review(path, id); d.seal(path, id, { status: "accepted" }); commit(path);
  write(path, `${unit}/fixed-bug.log`, "obsolete failure"); commit(path); rmSync(join(path, `${unit}/fixed-bug.log`)); commit(path);
  const { result } = deliver(path, id);
  assert.equal(readFileSync(join(root, unicode), "utf8"), "Current reviewed design\n");
  assert.equal(git(root, ["rev-list", "--count", `${baseline}..main`]), "1"); assert.equal(git(root, ["log", "main", "--format=%H", "--", `${unit}/fixed-bug.log`]), "");
  assert.equal(d.show(root, id).closed, true); assert.equal(d.show(root, id).delivery_commit, result.delivery_commit); assert.equal(d.finish(path, { id }).delivery_commit, result.delivery_commit);
  assert.throws(() => d.assertWritable(root, [`${unit}/product/current.md`]), /read-only/);
  assert.throws(() => d.start(root, { id: "M003", predecessor: "M001", path: join(dir, "bad"), approval: "start" }), /inherit completed M002/);
  const next = d.start(root, { id: "M002", predecessor: "M001", path: join(dir, "M002"), approval: "start" }); assert.equal(next.base_commit, result.delivery_commit);
  write(next.worktree, unicode, "illegal predecessor edit"); git(next.worktree, ["add", ".planning"]); assert.throws(() => d.checkGit(next.worktree, { staged: true }), /read-only/);
});
test("one-time remediation is scoped to exact closed ID, branch and baseline and leaves it closed", t => {
  const { root, dir } = fixture(t), path = ready(root, dir); deliver(path, "M001");
  const task = d.start(root, { id: "Q001-cleanup", path: join(dir, "cleanup"), approval: "User authorized historical cleanup" });
  const base = git(root, ["rev-parse", "main"]), maintenance = { source: "User one-time cleanup", ids: ["M001"], branch: "quick/Q001-cleanup", base_commit: base }, file = ".planning/milestones/M001/product/current.md";
  d.assertWritable(task.worktree, [file], { maintenance });
  assert.throws(() => d.assertWritable(task.worktree, [file], { maintenance: { ...maintenance, ids: ["M002"] } }), /read-only/);
  assert.throws(() => d.assertWritable(task.worktree, [file], { maintenance: { ...maintenance, base_commit: "bad" } }), /baseline/);
  write(task.worktree, file, "Consolidated same accepted behavior");
  const summaryPath = `${d.archiveRoot("M001")}/summary.json`, summary = JSON.parse(readFileSync(join(task.worktree, summaryPath))); summary.materials.find(m => m.path === file).sha256 = d.hash("Consolidated same accepted behavior");
  write(task.worktree, summaryPath, summary); git(task.worktree, ["add", "."]); assert.equal(d.checkGit(task.worktree, { staged: true, maintenance }).pass, true);
  summary.closed = false; write(task.worktree, summaryPath, summary); git(task.worktree, ["add", "."]); assert.throws(() => d.checkGit(task.worktree, { staged: true, maintenance }), /must leave M001 closed/);
});
test("final delivery rejects stale source, target and failed candidate checks", t => {
  const { root, dir } = fixture(t), path = ready(root, dir); d.prepare(path, { id: "M001" }); assert.throws(() => d.finish(path, { id: "M001" }), /Successful checks/);
  assert.throws(() => d.verify(path, { id: "M001", reviewer: "qa-quinn", approval: "checked", commands: [[process.execPath, "-e", "process.exit(1)"]] }), /checks failed/);
  assert.throws(() => d.finish(path, { id: "M001" }), /Successful checks/);
  write(root, "unrelated.txt", "main advanced"); commit(root); assert.throws(() => d.finish(path, { id: "M001" }), /Main changed/);
  d.prepare(path, { id: "M001" }); write(path, "new.txt", "source advanced"); commit(path);
  assert.throws(() => d.verify(path, { id: "M001", reviewer: "qa", approval: "checked", commands: [[process.execPath, "-e", "0"]] }), /Source changed/);
});
test("parent cannot deliver unintegrated child; live binding does not leak to main", t => {
  const { root, dir } = fixture(t), path = ready(root, dir); git(path, ["branch", "agt/M001/login"]);
  const child = join(dir, "child"); git(path, ["worktree", "add", child, "agt/M001/login"]); write(child, "child.txt", "child work"); commit(child);
  assert.throws(() => d.prepare(path, { id: "M001" }), /unintegrated changes/); git(path, ["merge", "--no-ff", "agt/M001/login", "-m", "integrate child"]);
  write(path, ".planning/agt/workstreams.json", { target: "milestone/M001", milestone: "M001" }); commit(path);
  review(path, "M001"); d.seal(path, "M001", { status: "accepted" }); commit(path); deliver(path, "M001");
  assert.equal(existsSync(join(root, ".planning/agt/workstreams.json")), false); assert.equal(existsSync(join(root, "child.txt")), true);
});
test("inventory resists symlinks, supports Quick children and keeps CLI explicit", t => {
  const { root, dir } = fixture(t), path = ready(root, dir); assert.equal(d.unitRoot("Q001-parent--child"), ".planning/quick/Q001-parent/workstreams/child");
  const outside = join(dir, "outside"); writeFileSync(outside, "private"); symlinkSync(outside, join(path, ".planning/milestones/M001/escape")); assert.throws(() => d.inventory(path, "M001"), /Symlink/);
  const cli = resolve("adapters/delivery/agt-delivery.mjs"), run = (...args) => spawnSync(process.execPath, [cli, ...args, "--project", root], { encoding: "utf8" });
  assert.equal(run("--help").status, 0); assert.notEqual(run("archive-milestone", "--id", "M001").status, 0); assert.notEqual(run("deploy").status, 0);
});

test("post-acceptance code or unreviewed planning cannot enter the final candidate", t => {
  const { root, dir } = fixture(t), path = ready(root, dir);
  write(path, "app.txt", "unverified behavior"); commit(path);
  assert.throws(() => d.prepare(path, { id: "M001" }), /Code changed after acceptance/);
  review(path, "M001"); d.seal(path, "M001", { status: "accepted" }); commit(path);
  write(path, ".planning/milestones/M001/forgotten-process.log", "unreviewed process"); commit(path);
  assert.throws(() => d.prepare(path, { id: "M001" }), /unreviewed or missing material/);
});

test("parent consolidation retires child process dependencies while preserving integration", t => {
  const { root, dir } = fixture(t), path = ready(root, dir), child = "M001-login", childRoot = d.unitRoot(child);
  git(path, ["branch", "agt/M001/login"]); const childPath = join(dir, "child"); git(path, ["worktree", "add", childPath, "agt/M001/login"]);
  write(childPath, `${childRoot}/product.md`, "Child effective requirement"); commit(childPath); review(childPath, child);
  d.seal(childPath, child, { status: "accepted" }); commit(childPath);
  git(path, ["merge", "--no-ff", "agt/M001/login", "-m", "integrate accepted child"]);
  write(path, `${childRoot}/workflow/integration.json`, { id: "login", source_commit: git(childPath, ["rev-parse", "HEAD"]) });
  write(path, ".planning/milestones/M001/product/current.md", "Final parent behavior includes child requirement");
  rmSync(join(path, `${childRoot}/product.md`)); commit(path);
  review(path, "M001"); d.seal(path, "M001", { status: "accepted" });
  d.consolidate(path, { id: "M001", child, reason: "Effective child requirement integrated into parent current document" }); commit(path);
  assert.equal(existsSync(join(path, `${d.archiveRoot(child)}/summary.json`)), false);
  assert.equal(existsSync(join(path, `${childRoot}/workflow/integration.json`)), true);
  assert.equal(d.checkGit(path).pass, true);
  assert.equal(d.validateSummary(path, "M001").summary.facts.consolidated_workstreams[0].id, child);
});

test("historical cleanup preserves original acceptance and seals explicitly owned legacy-number directories", t => {
  const { root, dir } = fixture(t);
  for (const id of ["M001", "M002"]) write(root, `${d.unitRoot(id)}/reviews/final.md`, `${id} was previously accepted; retained limits unchanged`);
  const extra = ".planning/milestones/M002-legacy-M003"; write(root, `${extra}/design.md`, "Effective M002 design under corrected historical numbering");
  const original = commit(root);
  const task = d.start(root, { id: "Q001-remediation", path: join(dir, "remediation"), approval: "One-time cleanup" });
  const maintenance = { source: "User instructed one-time historical cleanup", ids: ["M001", "M002"], branch: "quick/Q001-remediation", base_commit: original };
  review(task.worktree, "M001");
  assert.throws(() => d.adoptClosed(task.worktree, "M001", { original_acceptance: { commit: original, path: ".planning/milestones/M001/reviews/final.md" } }), /maintenance/);
  d.adoptClosed(task.worktree, "M001", { maintenance, original_acceptance: { commit: original, path: ".planning/milestones/M001/reviews/final.md" } });
  const materials = d.inventory(task.worktree, "M002", { additional_roots: [extra] }).map(f => ({ path: f.path, disposition: "current", reason: "Current accepted M002 content" }));
  d.review(task.worktree, "M002", { reviewer: "delivery-jordan", outcome: "Historical M002 unchanged", verification: "Original accepted result retained", limitations: "No new QA", retained_items: [], additional_roots: [extra], materials });
  const adopted = d.adoptClosed(task.worktree, "M002", { maintenance, predecessor: "M001", additional_roots: [extra], original_acceptance: { commit: original, path: ".planning/milestones/M002/reviews/final.md" } });
  assert.equal(adopted.new_business_acceptance, false); assert.equal(d.validateSummary(task.worktree, "M002").summary.verification_kind, "historical_acceptance_preserved");
  commit(task.worktree);
  assert.throws(() => d.assertWritable(task.worktree, [`${extra}/design.md`]), /read-only/);
  assert.throws(() => d.inventory(task.worktree, "M002", { additional_roots: [".planning/milestones/M003"] }), /legacy-number/);
  d.assertWritable(task.worktree, [`${extra}/design.md`], { maintenance });
});

test("completed legacy Quick imports without stale originals or claiming new test execution", t => {
  const { root, dir } = fixture(t), id = "Q001-previous";
  write(root, ".planning/agt/quick-tasks.json", { schema_version: 1, enabled: true, adoption_source: "Previously adopted" });
  write(root, `${d.unitRoot(id)}/task.json`, { schema_version: 1, id, title: "Previously completed fix", request: "User requested fix", branch: "main", status: "complete", checks: [{ evidence: [{ path: "deleted-failure.log" }] }] });
  write(root, `${d.unitRoot(id)}/outcome.md`, "Final result remains valid"); const original = commit(root);
  const task = d.start(root, { id: "Q002-remediation", path: join(dir, "remediation"), approval: "One-time cleanup" });
  const maintenance = { source: "User cleanup", ids: [id], branch: "quick/Q002-remediation", base_commit: original };
  review(task.worktree, id);
  const adopted = d.adoptClosed(task.worktree, id, { maintenance });
  assert.equal(adopted.tests_reexecuted, false);
  const result = quick.show(task.worktree, id); assert.equal(result.status, "complete"); assert.equal(result.verification.reexecuted, false);
  assert.equal(result.delivery_now.status, "closed"); assert.deepEqual(result.validation_now, []);
  assert.equal(quick.list(task.worktree).find(item => item.id === id).status, "complete");
  assert.equal(existsSync(join(task.worktree, `${d.archiveRoot(id)}/archive.json.gz`)), false);
  assert.throws(() => quick.change(task.worktree, id, "start"), /immutable|Closed/);
  write(task.worktree, `${d.unitRoot(id)}/outcome.md`, "Changed after closeout");
  assert.throws(() => quick.show(task.worktree, id), /Final material changed/);
});

test("final squash rejects unrelated unfinished planning while allowing unchanged inherited directories", t => {
  const { root, dir } = fixture(t);
  write(root, ".planning/milestones/M009/existing.md", "Unchanged legacy directory"); commit(root);
  const path = ready(root, dir), id = "M001";
  const initial = d.prepare(path, { id }); assert.equal(initial.status, "prepared");
  write(path, ".planning/milestones/M004/active.md", "Unfinished unrelated work"); commit(path);
  assert.throws(() => d.prepare(path, { id }), /Unfinished unrelated planning cannot enter main/);
  rmSync(join(path, ".planning/milestones/M004"), { recursive: true });
  write(path, ".planning/quick/Q099-unfinished/task.json", "Unfinished unrelated Quick"); commit(path);
  assert.throws(() => d.prepare(path, { id }), /Unfinished unrelated planning cannot enter main/);
});

test("removing an entire legacy active unit requires explicit scoped migration", t => {
  const { root, dir } = fixture(t);
  write(root, ".planning/milestones/M004/active.md", "Old main contains unfinished planning"); commit(root);
  const path = ready(root, dir), id = "M001", base = git(root, ["rev-parse", "main"]);
  rmSync(join(path, ".planning/milestones/M004"), { recursive: true }); commit(path);
  assert.throws(() => d.prepare(path, { id }), /Whole-unit removal needs explicit migration authorization/);
  const prepared = d.prepare(path, { id, maintenance: { source: "User authorized moving active M004 off main", ids: ["M004"], branch: "milestone/M001", base_commit: base } });
  assert.equal(prepared.status, "prepared");assert.equal(existsSync(join(prepared.worktree, ".planning/milestones/M004")),false);
});

test("final squash refuses a moved inherited source even when its later commit was manually merged", t => {
  const { root, dir } = fixture(t), path = ready(root, dir), frozen = git(path, ["rev-parse", "HEAD"]);
  git(path, ["branch", "agt/M001/previous"]);
  write(path, ".planning/agt/workstreams.json", { target: "milestone/M001", parent: { id: "M001" }, inherited_workstreams: [{ id: "previous", source_commit: frozen, integration_commit: frozen }] }); commit(path);
  assert.equal(d.prepare(path, { id: "M001" }).status, "prepared");
  const old = join(dir, "old-source"); git(path, ["worktree", "add", old, "agt/M001/previous"]);
  write(old, "later.txt", "Later change on retired source"); commit(old); git(path, ["merge", "--no-ff", "agt/M001/previous", "-m", "manual later merge"]);
  review(path, "M001"); d.seal(path, "M001", { status: "accepted" }); commit(path);
  assert.throws(() => d.prepare(path, { id: "M001" }), /Inherited workstream changed since adoption/);
});
