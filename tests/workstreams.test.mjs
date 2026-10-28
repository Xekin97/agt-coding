import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { git, readJson, readYaml, resolveContext, artifacts, CONFIG } from "../adapters/workstreams/context.mjs";
import * as ws from "../adapters/workstreams/workstreams.mjs";
import { readActiveState } from "../adapters/codex/model-router.mjs";

const profile = resolve("profiles/consumer-ai-web/PROFILE.yaml");
const write = (path, value) => { mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); };
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agt-stream-test-"))), project = join(dir, "product");
  mkdirSync(project);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "Workstream Test"]);
  git(project, ["config", "user.email", "workstream@example.invalid"]);
  git(project, ["config", "commit.gpgsign", "false"]);
  write(join(project, ".planning/agt/project.yaml"), { profile: { id: "consumer-ai-web", version: readYaml(profile).version }, agt: { git_revision: "approved-framework-revision" } });
  write(join(project, ".planning/workflow/state.yaml"), { milestone: "M001", stage: "product-planning", status: "active", active_role: "product/to-c", active_agent: "product-maya" });
  write(join(project, ".planning/agt/agents.yaml"), { agents: [{ role: "product/to-c", display_name: "product-maya", status: "active" }] });
  write(join(project, "app.txt"), "base\n");
  commit(project);
  ws.enable(project, { profile, milestone: "M001", target: "main", approval: "User adopted workstreams" });
  commit(project);
  return { dir, project };
}
function commit(project, message = "fixture change") { git(project, ["add", "."]); git(project, ["commit", "-m", message]); return git(project, ["rev-parse", "HEAD"]); }
function create(project, id = "login", agent = "product-alice", dependencies = []) {
  return ws.create(project, { id, title: id, scope: `Confirmed ${id} scope`, agent, dependencies });
}
function ready(worktree) {
  const c = resolveContext(worktree), state = readYaml(join(worktree, c.state));
  for (const stage of c.config.profile.workflow.stages) for (const path of artifacts(c.config.profile, "M001", c.id, stage.id)) write(join(worktree, path), `Approved ${c.id} ${path}\n`);
  Object.assign(state, { stage: "milestone-complete", active_agent: null, active_role: null, status: "completed", pending_user_decisions: [], open_change_requests: [] });
  write(join(worktree, c.state), state);
  const approval = `${c.artifact_root}/workflow/decision.md`, evidence = `${c.artifact_root}/verification/report.md`;
  write(join(worktree, approval), "User explicitly approved this requirement. Decision DEC-1.\n");
  if (git(worktree, ["status", "--porcelain"])) commit(worktree);
  const session = ws.claim(worktree, { id: c.id, owner: "fixture-window", pid: process.pid });
  ws.accept(worktree, { token: session.token, approval, decision: "DEC-1", evidence: [evidence] });
  ws.release(worktree, { id: c.id, token: session.token });
  return c;
}
const checks = text => [[process.execPath, "-e", `const fs=require('node:fs'); if(!fs.readFileSync('app.txt','utf8').includes(${JSON.stringify(text)})) process.exit(1);`]];

test("opt-in preserves legacy state; two worktrees resolve independent roles and model launches", t => {
  const { project } = fixture(t), a = create(project), b = create(project, "report", "product-bob");
  assert.equal(resolveContext(project).mode, "coordinator");
  assert.equal(readActiveState(project).active_agent, "product-maya");
  const ca = resolveContext(a.worktree), cb = resolveContext(b.worktree);
  const state = readYaml(join(a.worktree, ca.state)); state.stage = "implementation"; state.active_role = "frontend-implementer/base"; state.active_agent = "frontend-alice";
  write(join(a.worktree, ca.state), state);
  write(join(a.worktree, ca.agents), { agents: [{ role: state.active_role, display_name: state.active_agent, status: "active" }] });
  assert.equal(readActiveState(a.worktree).active_agent, "frontend-alice");
  assert.equal(readActiveState(b.worktree).active_agent, "product-bob");
  assert.equal(readYaml(join(project, ".planning/workflow/state.yaml")).active_agent, "product-maya");
  const view = ws.list(b.worktree);
  assert.equal(view.find(x => x.id === "login").stage, "implementation");
  assert.equal(view.find(x => x.id === "login").committed_stage, "product-planning");
  assert.equal(view.find(x => x.id === "login").dirty, true);
  assert.ok(cb.required_artifacts.every(p => p.includes("/workstreams/report/")));
  assert.equal(ws.resume(b.worktree, { id: "login" }).project, a.worktree);
  git(b.worktree, ["switch", "-c", "unbound"]);
  assert.throws(() => resolveContext(b.worktree), /No workstream binding/);
});

test("writer leases, dead-owner recovery and project-wide role uniqueness", t => {
  const { project } = fixture(t), a = create(project), b = create(project, "report", "product-bob");
  assert.throws(() => create(project, "duplicate", "product-alice"), /reserved/);
  const s = ws.claim(a.worktree, { id: "login", owner: "window-a", pid: process.pid });
  assert.throws(() => ws.claim(b.worktree, { id: "login", owner: "window-b", pid: process.pid }), /already claimed/);
  assert.throws(() => ws.recover(project, { id: "login", token: s.token }), /still alive/);
  assert.throws(() => ws.release(project, { id: "login", token: "incorrect" }), /session token/);
  assert.throws(() => ws.activate(a.worktree, { role: "product/to-c", agent: "product-bob", token: s.token, approval: "activate" }), /reserved/);
  assert.throws(() => ws.activate(a.worktree, { role: "quality/base", agent: "qa-quinn", token: s.token, approval: "activate" }), /not allowed/);
  ws.activate(a.worktree, { role: "product/to-c", agent: "product-carol", token: s.token, approval: "user requested role" });
  assert.equal(readActiveState(a.worktree).active_agent, "product-carol");
  ws.release(project, { id: "login", token: s.token });
  assert.throws(() => ws.activate(project, { role: "product/to-c", agent: "product-bob", approval: "project role" }), /reserved/);
  ws.activate(project, { role: "product/to-c", agent: "product-diana", approval: "project role" });
  assert.equal(readActiveState(project).active_agent, "product-diana");
  assert.throws(() => create(b.worktree, "reserved-project-name", "product-diana"), /reserved/);
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  const file = join(project, ".git/agt-workstreams/sessions/M001-login.json");
  write(file, { ...s, pid: dead });
  ws.recover(b.worktree, { id: "login", token: s.token });
  assert.equal(existsSync(file), false);
  const operationLock = join(project, ".git/agt-workstreams/operation.lock");
  write(operationLock, { token: "dead-operation", pid: dead, host: hostname() });
  assert.throws(() => ws.resume(project, { id: "login" }), /locked/);
  ws.recover(project, { token: "dead-operation", operationLock: true });
  assert.equal(existsSync(operationLock), false);
});

test("any window integrates A then B against latest target; docs/history survive and safe cleanup retains branches", t => {
  const { project } = fixture(t), a = create(project), b = create(project, "report", "product-bob");
  write(join(a.worktree, "login.txt"), "login feature\n"); ready(a.worktree);
  write(join(b.worktree, "report.txt"), "report feature\n"); ready(b.worktree);
  const baseline = git(project, ["rev-parse", "HEAD"]);
  const preparedA = ws.integrate(b.worktree, { id: "login" });
  assert.equal(git(project, ["rev-parse", "HEAD"]), baseline);
  assert.throws(() => ws.integrate(a.worktree, { id: "report" }), /Another integration/);
  assert.throws(() => ws.claim(a.worktree, { id: "login", owner: "competing-writer", pid: process.pid }), /Integration is pending/);
  assert.throws(() => ws.finish(project, { id: "login" }), /matching successful/);
  ws.check(b.worktree, { id: "login", commands: checks("base") });
  const finishedA = ws.finish(b.worktree, { id: "login" });
  assert.equal(git(project, ["rev-parse", "HEAD"]), finishedA.result_commit);
  assert.ok(existsSync(join(project, "login.txt")));
  const preparedB = ws.integrate(a.worktree, { id: "report" });
  assert.equal(preparedB.target_commit, finishedA.result_commit);
  ws.check(a.worktree, { id: "report", commands: [[process.execPath, "-e", "const fs=require('node:fs'); for(const p of ['login.txt','report.txt']) if(!fs.existsSync(p)) process.exit(1)"]] });
  ws.finish(a.worktree, { id: "report" });
  for (const id of ["login", "report"]) assert.ok(existsSync(join(project, `.planning/milestones/M001/workstreams/${id}/workflow/history.yaml`)));
  assert.equal(ws.list(project).every(x => x.integrated), true);
  write(join(a.worktree, "unsaved.txt"), "keep");
  assert.throws(() => ws.cleanup(project, { id: "login" }), /Uncommitted/);
  rmSync(join(a.worktree, "unsaved.txt"));
  ws.cleanup(project, { id: "login" });
  assert.equal(existsSync(a.worktree), false);
  assert.equal(existsSync(preparedA.worktree), false);
  assert.ok(git(project, ["show-ref", "--verify", "refs/heads/agt/M001/login"]));
  rmSync(join(project, ".git/agt-workstreams/locator.json"));
  assert.equal(ws.resume(b.worktree, { id: "login" }).id, "login");
});

test("failed checks, changed candidate and dirty target never update the target", t => {
  const { project } = fixture(t), a = create(project); ready(a.worktree);
  const old = git(project, ["rev-parse", "HEAD"]), job = ws.integrate(project, { id: "login" });
  assert.throws(() => ws.check(project, { id: "login", commands: [[process.execPath, "-e", "process.exit(7)"]] }), /checks failed/);
  assert.equal(existsSync(join(project, ".git/agt-workstreams/integration-active.json")), false);
  assert.equal(git(project, ["rev-parse", "HEAD"]), old);
  ws.check(project, { id: "login", commands: checks("base") });
  write(join(job.worktree, "extra.txt"), "after tests"); commit(job.worktree);
  assert.throws(() => ws.finish(project, { id: "login" }), /matching successful/);
  ws.check(project, { id: "login", commands: checks("base") });
  write(join(project, "app.txt"), "unsaved user work\n");
  assert.throws(() => ws.finish(project, { id: "login" }), /Uncommitted/);
  assert.equal(readFileSync(join(project, "app.txt"), "utf8"), "unsaved user work\n");
  assert.equal(git(project, ["rev-parse", "HEAD"]), old);
});

test("source edits invalidate approval; target changes require reprepare and fresh checks", t => {
  const { project } = fixture(t), a = create(project); ready(a.worktree);
  write(join(a.worktree, "late.txt"), "changed after approval"); commit(a.worktree);
  assert.throws(() => ws.integrate(project, { id: "login" }), /changed since approval/);
  ready(a.worktree);
  ws.integrate(project, { id: "login" }); ws.check(project, { id: "login", commands: checks("base") });
  write(join(project, "new-main.txt"), "target advanced"); commit(project);
  const advanced = git(project, ["rev-parse", "HEAD"]);
  assert.throws(() => ws.finish(project, { id: "login" }), /Target changed/);
  assert.equal(git(project, ["rev-parse", "HEAD"]), advanced);
  const job = ws.integrate(project, { id: "login" });
  assert.equal(job.target_commit, advanced);
  assert.throws(() => ws.finish(project, { id: "login" }), /matching successful/);
  ws.check(project, { id: "login", commands: checks("base") }); ws.finish(project, { id: "login" });
});

test("merge conflicts retain a recoverable candidate and no target mutation", t => {
  const { project } = fixture(t), a = create(project);
  write(join(a.worktree, "app.txt"), "feature value\n"); ready(a.worktree);
  write(join(project, "app.txt"), "target value\n"); commit(project);
  const old = git(project, ["rev-parse", "HEAD"]), job = ws.integrate(a.worktree, { id: "login" });
  assert.equal(job.status, "conflict");
  assert.equal(git(project, ["rev-parse", "HEAD"]), old);
  assert.equal(existsSync(join(project, ".git/agt-workstreams/integration-active.json")), false);
  write(join(job.worktree, "app.txt"), "agreed combined value\n"); commit(job.worktree, "resolve reviewed conflict");
  ws.check(project, { id: "login", commands: checks("combined") }); ws.finish(project, { id: "login" });
  assert.equal(readFileSync(join(project, "app.txt"), "utf8"), "agreed combined value\n");
});

test("dependencies require integration and synchronization before acceptance can be used", t => {
  const { project } = fixture(t), a = create(project), b = create(project, "report", "product-bob", ["login"]);
  ready(a.worktree); ready(b.worktree);
  assert.throws(() => ws.integrate(project, { id: "report" }), /Dependency not integrated/);
  ws.integrate(project, { id: "login" }); ws.check(project, { id: "login", commands: checks("base") }); ws.finish(project, { id: "login" });
  assert.throws(() => ws.integrate(project, { id: "report" }), /Synchronize/);
  git(b.worktree, ["merge", "--no-edit", "main"]); ready(b.worktree);
  ws.integrate(project, { id: "report" }); ws.check(project, { id: "report", commands: checks("base") }); ws.finish(project, { id: "report" });
});

test("shared state cannot be overwritten by a requirement; legacy non-Git consumers still resolve", t => {
  const { dir, project } = fixture(t), a = create(project);
  write(join(a.worktree, ".planning/workflow/state.yaml"), { milestone: "M001", stage: "implementation" }); ready(a.worktree);
  assert.throws(() => ws.integrate(project, { id: "login" }), /Shared planning change/);
  const legacy = join(dir, "legacy"); mkdirSync(legacy);
  write(join(legacy, ".planning/workflow/state.yaml"), { stage: "implementation", status: "active", active_role: "frontend-implementer/base", active_agent: "frontend-bob" });
  write(join(legacy, ".planning/agt/agents.yaml"), { agents: [{ role: "frontend-implementer/base", display_name: "frontend-bob", status: "active" }] });
  assert.equal(resolveContext(legacy).mode, "single");
  assert.equal(readActiveState(legacy).active_agent, "frontend-bob");
  const result = spawnSync(process.execPath, [resolve("adapters/workstreams/agt-workstream.mjs"), "context", "--project", a.worktree], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).id, "login");
  assert.equal(readJson(join(project, CONFIG)).mode, "workstreams");
});

test("two independent processes cannot both claim the same requirement", async t => {
  const { project } = fixture(t), a = create(project);
  const cli = resolve("adapters/workstreams/agt-workstream.mjs");
  const run = owner => new Promise(resolveResult => {
    const child = spawn(process.execPath, [cli, "claim", "--project", a.worktree, "--id", "login", "--owner", owner, "--pid", String(process.pid)]);
    let stdout = "", stderr = "";
    child.stdout.on("data", x => { stdout += x; }); child.stderr.on("data", x => { stderr += x; });
    child.on("close", status => resolveResult({ status, stdout, stderr }));
  });
  const results = await Promise.all([run("window-a"), run("window-b")]);
  assert.equal(results.filter(x => x.status === 0).length, 1);
  assert.match(results.find(x => x.status !== 0).stderr, /locked|already claimed/);
  ws.release(project, { id: "login", token: JSON.parse(results.find(x => x.status === 0).stdout).token });
});

test("target need not be checked out; check mutations and planning edits cannot bypass validation", t => {
  const { project } = fixture(t), a = create(project); ready(a.worktree);
  git(project, ["switch", "--detach"]);
  const target = git(project, ["rev-parse", "main"]), job = ws.integrate(a.worktree, { id: "login" });
  assert.throws(() => ws.check(a.worktree, { id: "login", commands: [[process.execPath, "-e", "require('node:fs').writeFileSync('app.txt','dirty test output')"]] }), /Uncommitted/);
  assert.equal(git(project, ["rev-parse", "main"]), target);
  write(join(job.worktree, "app.txt"), "base\n");
  const statePath = ".planning/workflow/state.yaml", original = readFileSync(join(job.worktree, statePath), "utf8");
  write(join(job.worktree, statePath), "stage: wrong\n"); commit(job.worktree);
  assert.throws(() => ws.check(a.worktree, { id: "login", commands: checks("base") }), /changed approved\/shared planning/);
  write(join(job.worktree, statePath), original); commit(job.worktree);
  ws.check(a.worktree, { id: "login", commands: checks("base") });
  const result = ws.finish(a.worktree, { id: "login" });
  assert.equal(git(project, ["rev-parse", "main"]), result.result_commit);
  assert.equal(git(project, ["rev-parse", "HEAD"]), target);
});
