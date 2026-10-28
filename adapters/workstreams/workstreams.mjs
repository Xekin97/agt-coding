import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { CONFIG, LOCAL_CONFIG, assert, git, yaml, readYaml, readJson, inside, safePath, streamRoot, parentId, validateConfig, artifacts, worktrees, resolveContext } from "./context.mjs";

import * as delivery from "../delivery/delivery.mjs";

const framework = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value, null, 2) + "\n";
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, json(value), { flag: "wx" });
  renameSync(temp, path);
}
function repo(project) {
  const root = git(project, ["rev-parse", "--show-toplevel"]);
  const common = resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  return { root, common, local: join(common, "agt-workstreams") };
}
const at = (root, ref, path, optional = false) => git(root, ["show", `${ref}:${safePath(path)}`], optional);
const head = (root, ref = "HEAD") => git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
const ancestor = (root, older, newer) => git(root, ["merge-base", "--is-ancestor", older, newer], true) !== null;
function treeEntries(root, ref) {
  return new Map(git(root, ["ls-tree", "-r", "-z", ref, "--", ".planning", ".agt"]).split("\0").filter(Boolean).map(entry => {
    const tab = entry.indexOf("\t");
    return [entry.slice(tab + 1), entry.slice(0, tab)];
  }));
}
const dirty = root => git(root, ["status", "--porcelain", "--untracked-files=all"]);
function clean(root) { assert(!dirty(root), `Uncommitted changes in ${root}; commit scoped changes first`); }
function commitPaths(root, paths, message) {
  git(root, ["add", "--", ...paths]);
  if (delivery.policy(root)) delivery.checkGit(root, { staged: true });
  git(root, ["commit", "-m", message, "--", ...paths]);
  return head(root);
}
function operation(project, action) {
  const r = repo(project), path = join(r.local, "operation.lock");
  if (delivery.policy(r.root)?.schema_version === 2) {
    const branch = git(r.root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true);
    assert(branch && branch !== (delivery.policy(r.root).main_branch || "main"), "Use the owning milestone/Quick branch; direct main writes are forbidden");
    const configPath = existsSync(inside(r.root, CONFIG)) ? CONFIG : LOCAL_CONFIG;
    if (existsSync(inside(r.root, configPath))) {
      const binding = readJson(inside(r.root, configPath)), parent = parentId(binding);
      assert(branch === binding.target || branch.startsWith(`agt/${parent}/`), "No workstream binding for current branch");
      delivery.assertWritable(r.root, [`.planning/${parent.startsWith("Q") ? "quick" : "milestones"}/${parent}`]);
    }
  }
  mkdirSync(r.local, { recursive: true });
  const owner = { token: randomUUID(), pid: process.pid, host: hostname(), started_at: now() };
  try { writeFileSync(path, json(owner), { flag: "wx" }); }
  catch (e) { if (e.code === "EEXIST") throw Error(`Management operation locked: ${path}; inspect owner, recover only after process exits`); throw e; }
  try { return action(r); }
  finally { if (existsSync(path) && readJson(path).token === owner.token) rmSync(path); }
}
const localMode = c => c.planning_storage === "local";
const branchMode = c => c.planning_storage === "branch";
const unitId = (c, id) => `${parentId(c)}${c.parent?.kind === "quick" ? "--" : "-"}${id}`;
const recordPath = (c, m, name) => localMode(c) ? `${delivery.archiveRoot(unitId(c, m.id))}/${name}.json` : `${m.root}/workflow/${name}.json`;
function configAt(r, ref) {
  const modern = at(r.root, ref, LOCAL_CONFIG, true), legacy = at(r.root, ref, CONFIG, true);
  assert(!(modern && legacy), "Conflicting legacy/local workstream configurations");
  return modern || legacy;
}
function configFor(r) {
  // Prefer this worktree's committed binding; a shared locator is not authority
  // when multiple milestones or Quick parents are active.
  const current = [CONFIG, LOCAL_CONFIG].filter(p => existsSync(inside(r.root, p)));
  assert(current.length < 2, "Conflicting workstream configurations");
  if (current.length) {
    const local = validateConfig(readJson(inside(r.root, current[0])));
    const raw = configAt(r, `refs/heads/${local.target}`);
    assert(raw, "Committed workstream configuration missing on integration target");
    const committed = validateConfig(JSON.parse(raw));
    assert(committed.target === local.target && parentId(committed) === parentId(local), "Parent binding changed; inspect configuration");
    return committed;
  }
  const locator = join(r.local, "locator.json");
  let target;
  if (existsSync(locator)) target = readJson(locator).target;
  else {
    const refs = git(r.root, ["for-each-ref", "--format=%(refname)", "refs/heads/"]).split("\n").filter(Boolean);
    const targets = [...new Set(refs.map(ref => configAt(r, ref)).filter(Boolean).map(s => validateConfig(JSON.parse(s)).target))];
    assert(targets.length === 1, "Cannot identify unique integration target; enable/commit configuration or resolve ambiguity");
    target = targets[0];
  }
  const raw = configAt(r, `refs/heads/${target}`);
  assert(raw, "Committed workstream configuration missing on integration target");
  const config = validateConfig(JSON.parse(raw));
  assert(config.target === target, "Integration target changed; inspect configuration before recovery");
  return config;
}
function localFiles(r, c, id) { return delivery.checkpointFiles(r.root, unitId(c, id)); }
function scopedText(r, c, m, path) {
  const wt = worktrees(r.root).find(w => w.branch === m.branch);
  if (wt) return readFileSync(inside(wt.path, path), "utf8");
  const files = localFiles(r, c, m.id);
  assert(Object.hasOwn(files, path), `Missing local checkpoint input: ${path}`);
  return Buffer.from(files[path], "base64").toString();
}
function metadata(r, config, id) {
  const root = streamRoot(parentId(config), id), branch = `agt/${parentId(config)}/${id}`;
  const m = { id, branch };
  const value = JSON.parse(localMode(config) ? scopedText(r, config, m, `${root}/workstream.json`) : at(r.root, `refs/heads/${branch}`, `${root}/workstream.json`));
  assert(value.id === id && value.branch === branch && value.target === config.target && value.milestone === config.milestone && (!branchMode(config) || value.parent?.id === parentId(config)), "Invalid workstream metadata");
  return { ...value, root };
}
function saveLocalCheckpoint(root, c, id) {
  const paths = [...delivery.inventory(root, unitId(c, id)).map(f => f.path), ...delivery.policy(root).bootstrap_paths];
  return delivery.checkpoint(root, unitId(c, id), [...new Set(paths)]);
}
export function checkpoint(project, { token }) {
  return operation(project, r => {
    const ctx = resolveContext(r.root);
    assert(ctx.mode === "workstream" && localMode(ctx.config), "Checkpoint is for local-planning workstreams");
    assertSession(r, ctx.config, ctx.id, token);
    return saveLocalCheckpoint(r.root, ctx.config, ctx.id);
  });
}
function sessionPath(r, config, id) { streamRoot(parentId(config), id); return join(r.local, "sessions", `${parentId(config)}-${id}.json`); }
function assertSession(r, config, id, token) {
  const path = sessionPath(r, config, id);
  assert(existsSync(path) && token && readJson(path).token === token, "Claim this workstream and supply its session token before writing");
  const session = readJson(path);
  assert(isAlive(session), "Writer process exited; recover the lease and claim a new session");
  return session;
}
function isAlive(owner) {
  assert(owner.host === hostname(), "Cannot verify a process on another host; inspect the shared repository manually");
  assert(Number.isSafeInteger(owner.pid) && owner.pid > 0, "Invalid lock owner PID");
  try { process.kill(owner.pid, 0); return true; }
  catch (e) { if (e.code === "ESRCH") return false; return true; }
}
function reservedNames(r) {
  const result = new Map();
  const add = (content, owner) => {
    for (const agent of yaml(content)?.agents || []) {
      const previous = result.get(agent.display_name);
      assert(!previous || previous === owner, `Duplicate semantic name: ${agent.display_name}`);
      result.set(agent.display_name, owner);
    }
  };
  for (const ref of git(r.root, ["for-each-ref", "--format=%(refname)", "refs/heads/"]).split("\n").filter(Boolean)) {
    for (const path of git(r.root, ["ls-tree", "-r", "--name-only", ref, "--", ".planning"]).split("\n")) {
      if (path === ".planning/agt/agents.yaml" || /\/workstreams\/[^/]+\/workflow\/agents.yaml$/.test(path)) add(at(r.root, ref, path), path);
    }
  }
  const cfg = configFor(r);
  if (localMode(cfg)) for (const branch of git(r.root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/agt/${parentId(cfg)}/`]).split("\n").filter(Boolean)) {
    const id = branch.split("/").at(-1), path = `${streamRoot(parentId(cfg), id)}/workflow/agents.yaml`;
    add(scopedText(r, cfg, { id, branch }, path), path);
  }
  // Include not-yet-committed role activations in live worktrees.
  for (const wt of worktrees(r.root)) {
    const projectRegistry = inside(wt.path, ".planning/agt/agents.yaml");
    if (existsSync(projectRegistry)) add(readFileSync(projectRegistry, "utf8"), ".planning/agt/agents.yaml");
    if (!wt.branch?.startsWith("agt/")) continue;
    const c = resolveContext(wt.path);
    if (c.mode === "workstream") add(readFileSync(inside(wt.path, c.agents), "utf8"), c.agents);
  }
  return result;
}
function validateName(name, prefix) {
  assert(typeof name === "string" && name.startsWith(`${prefix}-`), `Role requires ${prefix}-<person-name>`);
  const r = spawnSync("bash", [join(framework, "validators/validate-agent-name.sh"), name], { encoding: "utf8" });
  assert(r.status === 0, r.stderr || "Invalid semantic name");
}

export function enable(project, { profile, target, milestone, quick, approval }) {
  return operation(project, r => {
    assert(approval?.trim(), "Explicit adoption approval/source is required");
    assert(!existsSync(inside(r.root, CONFIG)) && !existsSync(inside(r.root, LOCAL_CONFIG)), "Workstreams already configured; never overwrite adoption");
    assert(git(r.root, ["symbolic-ref", "--short", "HEAD"]) === target, "Enable on the intended integration branch");
    git(r.root, ["check-ref-format", "--branch", target]);
    head(r.root, `refs/heads/${target}`);
    const validation = spawnSync("bash", [join(framework, "validators/validate-profile.sh"), resolve(profile)], { encoding: "utf8" });
    assert(validation.status === 0, validation.stderr || "Profile validation failed");
    const p = readYaml(profile), manifest = readYaml(inside(r.root, ".planning/agt/project.yaml"));
    assert(p.status === "available", "Profile must be available before adoption");
    const lockedProfile = manifest.profile || manifest.agt_base?.profile, frameworkRevision = manifest.agt?.git_revision || manifest.agt_base?.git_revision;
    assert(lockedProfile?.id === p.id && lockedProfile?.version === p.version && frameworkRevision, "Manifest must explicitly lock this Profile and framework revision before enabling");
    assert(!(milestone && quick) && (milestone || quick), "Choose one milestone or Quick parent");
    const adopted = delivery.policy(r.root), modern = adopted?.schema_version === 2;
    if (!quick) assert(readYaml(inside(r.root, ".planning/workflow/state.yaml")).milestone === milestone, "Milestone differs from project state");
    if (quick) {
      assert(modern, "Quick workstreams require branch planning adoption");
      const task = readJson(inside(r.root, `.planning/quick/${quick}/task.json`));
      assert(task.id === quick && task.branch === target && task.status === "active", "Quick parent must be active on its own branch");
    }
    if (modern) delivery.assertWritable(r.root, [`.planning/${quick ? "quick" : "milestones"}/${quick || milestone}`]);
    const config = validateConfig({ schema_version: modern ? 2 : 1,
      ...(adopted ? { planning_storage: modern ? "branch" : "local" } : {}), mode: "workstreams", milestone: milestone || null, target,
      ...(modern ? { parent: { kind: quick ? "quick" : "milestone", id: quick || milestone, branch: target, base_commit: head(r.root) } } : {}),
      profile: p, framework_revision: frameworkRevision, approval, adopted_at: now() });
    const destination = adopted && !modern ? LOCAL_CONFIG : CONFIG;
    if (adopted && !modern) {
      assert(p.workflow.delivery?.supported === true, "Profile must support task delivery");
      for (const required of [".planning/agt/project.yaml", ".planning/agt/agents.yaml", ".planning/workflow/state.yaml"]) assert(adopted.bootstrap_paths.includes(required), `Bootstrap must include ${required}`);
      delivery.checkGit(r.root);
      delivery.checkpoint(r.root, `bootstrap-${milestone}`, adopted.bootstrap_paths);
    }
    write(inside(r.root, destination), config);
    return { configuration: destination, next: "Commit the adoption configuration on the integration target before creating workstreams; existing state and approvals were preserved." };
  });
}

export function create(project, { id, title, scope, path, agent, dependencies = [] }) {
  return operation(project, r => {
    const c = configFor(r), root = streamRoot(parentId(c), id), branch = `agt/${parentId(c)}/${id}`;
    assert(title?.trim() && scope?.trim(), "Title and confirmed scope are required");
    assert(Array.isArray(dependencies) && new Set(dependencies).size === dependencies.length, "Dependencies must be a unique array of workstream IDs");
    assert(git(r.root, ["show-ref", "--verify", `refs/heads/${branch}`], true) === null, "Workstream branch already exists; resume it");
    assert(!at(r.root, `refs/heads/${c.target}`, `${root}/workstream.json`, true), "Workstream ID already integrated; choose a new ID");
    for (const dep of dependencies) { assert(dep !== id, "Cannot depend on itself"); metadata(r, c, dep); }
    const first = c.profile.workflow.stages.find(s => s.id === c.profile.workflow.initial_stage);
    const role = first.allowed_roles[0], definition = c.profile.roles.find(d => d.id === role);
    validateName(agent, definition.display_name_prefix);
    assert(!reservedNames(r).has(agent), `Semantic name already reserved: ${agent}`);
    const base = head(r.root, `refs/heads/${c.target}`), destination = resolve(path || join(dirname(r.root), `${parentId(c)}-${id}`));
    assert(!existsSync(destination), "Worktree destination already exists");
    git(r.root, ["worktree", "add", "-b", branch, destination, base]);
    if (localMode(c)) delivery.restoreCheckpoint(destination, `bootstrap-${parentId(c)}`);
    const data = { schema_version: 1, id, title, scope, milestone: c.milestone, ...(branchMode(c) ? { parent: c.parent } : {}), branch, target: c.target, base_commit: base, dependencies, shared_changes: [], created_at: now() };
    write(inside(destination, `${root}/workstream.json`), data);
    const state = readYaml(join(framework, "templates/workflow-state.yaml"));
    Object.assign(state, { profile: `${c.profile.id}@${c.profile.version}`, milestone: c.milestone, ...(branchMode(c) ? { parent: c.parent } : {}), workstream: id, stage: first.id, active_role: role, active_agent: agent, required_artifacts: artifacts(c.profile, parentId(c), id, first.id), allowed_transitions: ["remain_in_current_stage", ...first.transitions], last_transition: { from: null, to: first.id, confirmed_by: "user", decision_id: "workstream-creation", timestamp: now() } });
    write(inside(destination, `${root}/workflow/state.yaml`), state);
    write(inside(destination, `${root}/workflow/agents.yaml`), { schema_version: 1, agents: [{ role, display_name: agent, runtime_name: agent.replaceAll("-", "_"), runtime_id: null, status: "active", activated_at: now() }] });
    write(inside(destination, `${root}/workflow/history.yaml`), { schema_version: 1, transitions: [{ ...state.last_transition, scope: root }] });
    const commit = localMode(c) ? null : commitPaths(destination, [root], `agt: create ${parentId(c)}/${id}`);
    if (localMode(c)) saveLocalCheckpoint(destination, c, id);
    write(join(r.local, "locator.json"), { target: c.target });
    return { id, branch, worktree: destination, commit, next: "Open this worktree in any window and claim a writer session." };
  });
}

export function list(project) {
  const r = repo(project), c = configFor(r), trees = worktrees(r.root);
  return git(r.root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/agt/${parentId(c)}/`]).split("\n").filter(Boolean).map(branch => {
    const id = branch.split("/").at(-1), m = metadata(r, c, id), wt = trees.find(w => w.branch === branch);
    const statePath = `${m.root}/workflow/state.yaml`, committed = yaml(localMode(c) ? Buffer.from(localFiles(r, c, id)[statePath], "base64").toString() : at(r.root, `refs/heads/${branch}`, statePath));
    const current = wt ? readYaml(inside(wt.path, statePath)) : committed;
    const receipt = at(r.root, `refs/heads/${branch}`, recordPath(c, m, "acceptance"), true);
    let accepted = false, acceptance_error = null;
    if (receipt) {
      try { acceptance(r, c, m, head(r.root, `refs/heads/${branch}`)); accepted = true; }
      catch (e) { acceptance_error = e.message; }
    }
    const integrated = at(r.root, `refs/heads/${c.target}`, recordPath(c, m, "integration"), true);
    const record = integrated ? JSON.parse(integrated) : null;
    const integration = record ? { path: recordPath(c, m, "integration"), source_commit: record.source_commit, tested_commit: record.tested_commit, integrated_at: record.integrated_at } : null;
    return { id, title: m.title, branch, worktree: wt?.path || null, committed_stage: localMode(c) ? null : committed.stage, checkpoint_stage: localMode(c) ? committed.stage : null, stage: current.stage, active_agent: current.active_agent, status: current.status, pending_user_decisions: current.pending_user_decisions, open_change_requests: current.open_change_requests, context_entries: current.context_entries, dirty: wt ? Boolean(dirty(wt.path)) : false, dependencies: m.dependencies, shared_changes: m.shared_changes, accepted, acceptance_error, integrated: Boolean(record && ancestor(r.root, head(r.root, `refs/heads/${branch}`), `refs/heads/${c.target}`)), integration, session: existsSync(sessionPath(r, c, id)) ? readJson(sessionPath(r, c, id)) : null };
  });
}

export function claim(project, { id, owner, pid }) {
  return operation(project, r => {
    const c = configFor(r); metadata(r, c, id);
    assert(!existsSync(activeFile(r)) || readJson(activeFile(r)).key !== `${parentId(c)}/${id}`, "Integration is pending for this workstream; pause it before claiming a writer");
    assert(owner?.trim(), "Session owner label is required");
    const value = { token: randomUUID(), owner, pid: Number(pid), host: hostname(), started_at: now() };
    assert(isAlive(value), "Owner process is not alive; use the persistent terminal/agent PID, not a short-lived CLI PID");
    const path = sessionPath(r, c, id);
    mkdirSync(dirname(path), { recursive: true });
    try { writeFileSync(path, json(value), { flag: "wx" }); }
    catch (e) { if (e.code === "EEXIST") throw Error(`Writer session already claimed: ${path}`); throw e; }
    return value;
  });
}
export function release(project, { id, token }) {
  return operation(project, r => { const c = configFor(r); assertSession(r, c, id, token); rmSync(sessionPath(r, c, id)); return { released: id }; });
}
export function recover(project, { id, token, operationLock = false }) {
  const r = repo(project);
  const recoverFile = path => {
    const owner = readJson(path);
    assert(owner.token === token, "Lock token changed; inspect the current owner");
    assert(!isAlive(owner), "Owner process is still alive; release from its session");
    rmSync(path);
    return { recovered: path };
  };
  if (operationLock) {
    const guard = join(r.local, "recovery.lock");
    // Serialize recoverers so a second stale reader cannot unlink a fresh lock.
    writeFileSync(guard, json({ pid: process.pid, host: hostname() }), { flag: "wx" });
    try { return recoverFile(join(r.local, "operation.lock")); }
    finally { rmSync(guard); }
  }
  return operation(project, r => recoverFile(sessionPath(r, configFor(r), id)));
}
export function resume(project, { id, path }) {
  return operation(project, r => {
    const c = configFor(r), m = metadata(r, c, id), existing = worktrees(r.root).find(w => w.branch === m.branch);
    let destination = existing?.path;
    if (!destination) {
      destination = resolve(path || join(dirname(r.root), `${parentId(c)}-${id}`));
      assert(!existsSync(destination), "Resume destination already exists");
      git(r.root, ["worktree", "add", destination, m.branch]);
      if (localMode(c)) delivery.restoreCheckpoint(destination, unitId(c, id));
    }
    write(join(r.local, "locator.json"), { target: c.target });
    return { ...resolveContext(destination), next: "Read handoff and open items, then claim a writer session (or release/recover the previous session)." +
      (localMode(c) ? " Local planning recovery covers the last checkpoint only; later changes require the workspace backup." : "") };
  });
}

export function activate(project, { role, agent, token, approval }) {
  return operation(project, r => {
    const ctx = resolveContext(r.root);
    assert(["workstream", "coordinator"].includes(ctx.mode), "Use the existing stage gate for single-flow role activation");
    if (ctx.mode === "workstream") assertSession(r, ctx.config, ctx.id, token);
    assert(approval?.trim(), "Explicit role activation source is required");
    const state = readYaml(inside(r.root, ctx.state)), registry = readYaml(inside(r.root, ctx.agents));
    const stage = ctx.config.profile.workflow.stages.find(s => s.id === state.stage);
    assert(stage.allowed_roles.includes(role), "Role is not allowed in this stage");
    const definition = ctx.config.profile.roles.find(d => d.id === role);
    validateName(agent, definition.display_name_prefix);
    const reserved = reservedNames(r).get(agent);
    assert(!reserved || reserved === ctx.agents, `Semantic name already reserved: ${agent}`);
    const previous = registry.agents.find(a => a.display_name === agent);
    assert(!previous || previous.role === role, "Existing name belongs to another role");
    registry.agents.forEach(a => { a.status = "inactive"; });
    if (previous) previous.status = "active";
    else registry.agents.push({ role, display_name: agent, runtime_name: agent.replaceAll("-", "_"), runtime_id: null, status: "active", activated_at: now(), activation_source: approval });
    state.active_role = role; state.active_agent = agent;
    write(inside(r.root, ctx.agents), registry); write(inside(r.root, ctx.state), state);
    return { role, agent, stage: state.stage };
  });
}

function acceptance(r, c, m, source) {
  if (localMode(c)) {
    const a = JSON.parse(at(r.root, source, recordPath(c, m, "acceptance")));
    assert(ancestor(r.root, a.approved_commit, source), "Invalid approved commit");
    const dir = delivery.archiveRoot(unitId(c, m.id));
    const diff = git(r.root, ["diff", "--name-only", a.approved_commit, source]).split("\n").filter(Boolean);
    assert(diff.every(p => [`${dir}/acceptance.json`, `${dir}/summary.json`, `${dir}/archive.json.gz`].includes(p)), "Source changed since approval; revalidate");
    const archive = delivery.validateArchive(r.root, unitId(c, m.id), p => delivery.gitBytes(r.root, `${source}:${p}`));
    assert(archive.summary.archive_sha256 === a.archive_sha256 && archive.summary.source_commit === a.approved_commit, "Approved archive changed");
    const wt = worktrees(r.root).find(w => w.branch === m.branch);
    if (wt) {
      const current = delivery.inventory(wt.path, unitId(c, m.id));
      assert(current.length === archive.summary.materials.length && current.every(f => archive.summary.materials.some(m => m.path === f.path && m.sha256 === f.sha256)), "Local planning changed since acceptance; review and accept again");
    }
    const state = yaml(Buffer.from(archive.files[`${m.root}/workflow/state.yaml`], "base64").toString());
    assert(state.stage === c.profile.workflow.terminal_stage && state.workstream === m.id && state.milestone === c.milestone && state.profile === `${c.profile.id}@${c.profile.version}` && !state.pending_user_decisions?.length && !state.open_change_requests?.length, "Invalid archived acceptance state");
    assert(a.approval?.decision_id && archive.files[a.approval.source] && a.evidence?.length && a.evidence.every(p => archive.files[p]), "Missing archived approval/evidence");
    for (const stage of c.profile.workflow.stages) for (const p of artifacts(c.profile, parentId(c), m.id, stage.id)) assert(archive.files[p] !== undefined, `Missing archived artifact: ${p}`);
    return a;
  }
  const file = `${m.root}/workflow/acceptance.json`, a = JSON.parse(at(r.root, source, file));
  assert(/^[a-f0-9]{40,64}$/.test(a.approved_commit) && ancestor(r.root, a.approved_commit, source), "Invalid approved commit");
  const diff = git(r.root, ["diff", "--name-only", a.approved_commit, source]).split("\n").filter(Boolean);
  assert(diff.every(p => p === file || (branchMode(c) && p === `${delivery.archiveRoot(unitId(c, m.id))}/summary.json`)), "Source changed since approval; revalidate and record a new acceptance");
  if (branchMode(c)) {
    const summaryPath = `${delivery.archiveRoot(unitId(c, m.id))}/summary.json`;
    assert(createHash("sha256").update(delivery.gitBytes(r.root, `${source}:${summaryPath}`)).digest("hex") === a.summary_sha256, "Approved final summary changed");
    delivery.validateSummary(r.root, unitId(c, m.id), p => delivery.gitBytes(r.root, `${source}:${p}`));
  }
  const state = yaml(at(r.root, a.approved_commit, `${m.root}/workflow/state.yaml`));
  assert(state.workstream === m.id && state.milestone === c.milestone && state.profile === `${c.profile.id}@${c.profile.version}`, "Approval scope/Profile mismatch");
  assert(state.stage === c.profile.workflow.terminal_stage && !(state.pending_user_decisions?.length) && !(state.open_change_requests?.length), "Workstream must finish its stage gate without open blockers");
  assert(a.approval?.decision_id && a.approval?.source?.startsWith(`${m.root}/`) && at(r.root, a.approved_commit, a.approval.source), "Missing scoped user approval source");
  assert(Array.isArray(a.evidence) && a.evidence.length, "Version-matched evidence is required");
  for (const p of a.evidence) assert(p.startsWith(`${m.root}/`) && at(r.root, a.approved_commit, p), `Missing scoped evidence: ${p}`);
  for (const p of (branchMode(c) ? artifacts(c.profile, parentId(c), m.id, "final") : c.profile.workflow.stages.flatMap(stage => artifacts(c.profile, parentId(c), m.id, stage.id)))) assert(at(r.root, a.approved_commit, p, true) !== null, `Missing required artifact: ${p}`);
  return a;
}
export function accept(project, { token, approval, decision, evidence }) {
  return operation(project, r => {
    const ctx = resolveContext(r.root);
    assert(ctx.mode === "workstream", "Acceptance must run in its workstream");
    assertSession(r, ctx.config, ctx.id, token); clean(r.root);
    const commit = head(r.root), m = metadata(r, ctx.config, ctx.id);
    const record = { schema_version: 1, approved_commit: commit, approval: { source: approval, decision_id: decision }, evidence, recorded_at: now() };
    const path = recordPath(ctx.config, m, "acceptance");
    const local = localMode(ctx.config);
    const input = p => local ? (existsSync(inside(r.root, p)) ? readFileSync(inside(r.root, p), "utf8") : null) : at(r.root, commit, p, true);
    // Validate everything before creating the final receipt; no semantic approval is inferred.
    assert(decision?.trim() && approval?.startsWith(`${m.root}/`) && input(approval), "Missing scoped user approval source");
    assert(Array.isArray(evidence) && evidence.length, "Evidence paths are required");
    for (const p of evidence) assert(p.startsWith(`${m.root}/`) && input(p), `Missing evidence: ${p}`);
    const state = readYaml(inside(r.root, ctx.state));
    assert(state.stage === ctx.config.profile.workflow.terminal_stage && !state.pending_user_decisions?.length && !state.open_change_requests?.length, "Complete the stage gate first");
    for (const p of (branchMode(ctx.config) ? artifacts(ctx.config.profile, parentId(ctx.config), ctx.id, "final") : ctx.config.profile.workflow.stages.flatMap(stage => artifacts(ctx.config.profile, parentId(ctx.config), ctx.id, stage.id)))) assert(input(p) !== null, `Missing required artifact: ${p}`);
    let paths = [path];
    if (branchMode(ctx.config)) {
      const result = delivery.seal(r.root, unitId(ctx.config, ctx.id), { kind: "workstream", status: "accepted", approval: record.approval, code_commit: commit }, { required: [approval, ...evidence] });
      record.summary_sha256 = result.summary_sha256;
      paths.push(`${result.path}/summary.json`);
    }
    if (local) {
      delivery.checkGit(r.root, { base: m.base_commit });
      const required = [...new Set([approval, ...evidence, `${m.root}/workstream.json`, ctx.state, ...ctx.config.profile.workflow.stages.flatMap(s => artifacts(ctx.config.profile, parentId(ctx.config), ctx.id, s.id))])];
      const archived = delivery.seal(r.root, unitId(ctx.config, ctx.id), { kind: "workstream", status: "accepted", approval: record.approval, code_commit: commit }, { required });
      record.archive_sha256 = archived.archive_sha256;
      paths.push(`${archived.path}/summary.json`, `${archived.path}/archive.json.gz`);
      saveLocalCheckpoint(r.root, ctx.config, ctx.id);
    }
    write(inside(r.root, path), record);
    return { ...record, commit: commitPaths(r.root, paths, `agt: record acceptance ${ctx.id}`) };
  });
}

function jobFile(r, c, id) { streamRoot(parentId(c), id); return join(r.local, "integrations", `${parentId(c)}-${id}.json`); }
function activeFile(r) { return join(r.local, "integration-active.json"); }
function takeSlot(r, c, id) {
  const path = activeFile(r), key = `${parentId(c)}/${id}`;
  if (existsSync(path)) assert(readJson(path).key === key, "Another integration is pending; finish or pause it first");
  else write(path, { key, started_at: now() });
}
function freeSlot(r, c, id) {
  const path = activeFile(r);
  if (existsSync(path) && readJson(path).key === `${parentId(c)}/${id}`) rmSync(path);
}
function checkScope(r, m, source) {
  const paths = git(r.root, ["diff", "--name-only", m.base_commit, source]).split("\n");
  const ours = treeEntries(r.root, source), theirs = treeEntries(r.root, `refs/heads/${m.target}`);
  // Other streams may arrive through a normal synchronization merge. Compare
  // shared planning against the current target, rather than deleting its content.
  for (const p of paths) {
    if ((!p.startsWith(".planning/") && !p.startsWith(".agt/")) || p.startsWith(`${m.root}/`) || p.startsWith(`${delivery.archiveRoot(`${m.parent?.id || m.milestone}${m.parent?.kind === "quick" ? "--" : "-"}${m.id}`)}/`)) continue;
    assert(ours.get(p) === theirs.get(p), `Shared planning change needs its owning workflow: ${p}`);
  }
}
function checkDependencies(r, c, m, source, target) {
  assert(Array.isArray(m.dependencies) && Array.isArray(m.shared_changes), "Dependencies/shared_changes must be arrays");
  for (const id of m.dependencies) {
    const dep = metadata(r, c, id), raw = at(r.root, target, recordPath(c, dep, "integration"), true);
    assert(raw, `Dependency not integrated: ${id}`);
    const receipt = JSON.parse(raw);
    assert(ancestor(r.root, receipt.source_commit, source), `Synchronize integrated dependency and revalidate: ${id}`);
    assert(ancestor(r.root, head(r.root, `refs/heads/${dep.branch}`), target), `Dependency has unintegrated changes: ${id}`);
  }
  for (const change of m.shared_changes) {
    assert(change.path && change.approval && Array.isArray(change.consumers), "Shared change requires path, approval source and affected consumers");
    safePath(change.path);
    assert(change.approval.startsWith(`${m.root}/`) && (localMode(c) ? delivery.validateArchive(r.root, unitId(c, m.id), p => delivery.gitBytes(r.root, `${source}:${p}`)).files[change.approval] : at(r.root, source, change.approval)), "Missing shared contract approval");
  }
}
export function integrate(project, { id }) {
  return operation(project, r => {
    const c = configFor(r), m = metadata(r, c, id), source = head(r.root, `refs/heads/${m.branch}`), target = head(r.root, `refs/heads/${c.target}`);
    assert(!existsSync(sessionPath(r, c, id)), "Release the workstream writer session before integration");
    const wt = worktrees(r.root).find(w => w.branch === m.branch); if (wt) clean(wt.path);
    acceptance(r, c, m, source);
    if (localMode(c)) delivery.checkGit(r.root, { base: m.base_commit, ref: source });
    checkScope(r, m, source); checkDependencies(r, c, m, source, target);
    assert(!ancestor(r.root, source, target), "Workstream is already integrated");
    takeSlot(r, c, id);
    const file = jobFile(r, c, id);
    try {
      if (existsSync(file)) {
        const old = readJson(file);
        if (old.source_commit === source && old.target_commit === target && existsSync(old.worktree)) return { ...old, next: "Resolve any conflicts, commit, then run check and finish." };
      }
      const worktree = join(dirname(r.common), "..", ".agt-integrations", `${parentId(c)}-${id}-${randomUUID().slice(0, 8)}`);
      git(r.root, ["worktree", "add", "--detach", resolve(worktree), target]);
      const job = { schema_version: 1, id, worktree: realpathSync(worktree), source_commit: source, target_commit: target, target: c.target, status: "prepared", started_at: now() };
      write(file, job);
      const result = spawnSync("git", ["merge", "--no-ff", "--no-edit", source], { cwd: job.worktree, encoding: "utf8" });
      if (result.status !== 0) {
        job.status = "conflict"; job.error = result.stderr || result.stdout; write(file, job); freeSlot(r, c, id);
        return { ...job, next: "Resolve conflicts in the retained integration worktree; commit and run check. Semantic conflicts return to their owners." };
      }
      write(file, job);
      return { ...job, next: "Run check with scoped integration commands, then finish." };
    } catch (e) { freeSlot(r, c, id); throw e; }
  });
}
function currentJob(r, c, id) {
  const job = readJson(jobFile(r, c, id)), m = metadata(r, c, id);
  assert(job.target_commit === head(r.root, `refs/heads/${c.target}`), "Target changed; prepare integration again and revalidate");
  assert(job.source_commit === head(r.root, `refs/heads/${m.branch}`), "Source changed; prepare integration again and revalidate");
  assert(!existsSync(sessionPath(r, c, id)), "Workstream writer active; release before integration");
  if (localMode(c)) acceptance(r, c, m, job.source_commit);
  assert(ancestor(job.worktree, job.target_commit, "HEAD") && ancestor(job.worktree, job.source_commit, "HEAD"), "Integration candidate must contain both approved source and target");
  assert(git(job.worktree, ["symbolic-ref", "--quiet", "HEAD"], true) === null, "Integration worktree must remain detached");
  clean(job.worktree);
  // Conflict resolution may edit application code, but must not rewrite scoped
  // approvals or silently replace another requirement's planning records.
  const candidate = treeEntries(job.worktree, "HEAD"), target = treeEntries(r.root, job.target_commit), source = treeEntries(r.root, job.source_commit);
  const planning = new Set([...candidate.keys(), ...target.keys(), ...source.keys()]);
  for (const path of planning) {
    if (!path || path === recordPath(c, m, "integration")) continue;
    const owned = localMode(c) ? delivery.archiveRoot(unitId(c, id)) : m.root;
    const expected = path.startsWith(`${owned}/`) || (branchMode(c) && path.startsWith(`${delivery.archiveRoot(unitId(c, id))}/`)) ? source : target;
    assert(candidate.get(path) === expected.get(path), `Candidate changed approved/shared planning: ${path}`);
  }
  if (localMode(c)) delivery.checkGit(job.worktree, { base: job.target_commit });
  return { job, m };
}
export function check(project, { id, commands }) {
  return operation(project, r => {
    const c = configFor(r); takeSlot(r, c, id);
    try {
      const { job } = currentJob(r, c, id);
      assert(Array.isArray(commands) && commands.length && commands.every(a => Array.isArray(a) && a.length && a.every(s => typeof s === "string" && s.length)), "Checks must be a non-empty array of argv arrays; no shell parsing");
      const before = head(job.worktree), results = [];
      job.status = "checking"; delete job.validation; write(jobFile(r, c, id), job);
      for (const argv of commands) {
        const result = spawnSync(argv[0], argv.slice(1), { cwd: job.worktree, encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
        results.push({ argv, exit_code: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
        if (result.status !== 0) break;
      }
      const evidence = join(r.local, "integrations", `${parentId(c)}-${id}-${randomUUID()}.checks.json`);
      write(evidence, { tested_commit: before, results, recorded_at: now() });
      job.last_checks = evidence; write(jobFile(r, c, id), job);
      assert(results.length === commands.length && results.every(result => result.exit_code === 0), `Integration checks failed; evidence: ${evidence}`);
      clean(job.worktree); assert(head(job.worktree) === before, "Checks changed the candidate commit; revalidate");
      job.status = "validated"; job.validation = { tested_commit: before, tree: git(job.worktree, ["rev-parse", "HEAD^{tree}"]), evidence, evidence_sha256: createHash("sha256").update(readFileSync(evidence)).digest("hex") };
      write(jobFile(r, c, id), job); return job;
    } catch (e) { freeSlot(r, c, id); throw e; }
  });
}
export function finish(project, { id }) {
  return operation(project, r => {
    const c = configFor(r); takeSlot(r, c, id);
    try {
      const { job, m } = currentJob(r, c, id), v = job.validation;
      assert(v && job.status === "validated" && v.tested_commit === head(job.worktree), "Candidate lacks matching successful integration checks");
      assert(createHash("sha256").update(readFileSync(v.evidence)).digest("hex") === v.evidence_sha256, "Check evidence changed");
      const sourceWt = worktrees(r.root).find(w => w.branch === m.branch); if (sourceWt) clean(sourceWt.path);
      const targetWt = worktrees(r.root).find(w => w.branch === c.target); if (targetWt) clean(targetWt.path);
      const integrationPath = recordPath(c, m, "integration");
      const record = { schema_version: 1, id, target: c.target, previous_target: job.target_commit, source_commit: job.source_commit, tested_commit: v.tested_commit, tested_tree: v.tree, checks: readJson(v.evidence), integrated_at: now() };
      write(inside(job.worktree, integrationPath), record);
      const candidate = commitPaths(job.worktree, [integrationPath], `agt: integrate ${parentId(c)}/${id}`);
      // Persist recovery information before changing the target ref.
      job.result_commit = candidate; job.status = "publishing"; write(jobFile(r, c, id), job);
      assert(head(r.root, `refs/heads/${c.target}`) === job.target_commit, "Target changed before update; reprepare and revalidate");
      if (targetWt) {
        clean(targetWt.path);
        assert(git(targetWt.path, ["symbolic-ref", "--short", "HEAD"]) === c.target, "Target worktree changed branch");
        git(targetWt.path, ["merge", "--ff-only", candidate]);
      } else git(r.root, ["update-ref", `refs/heads/${c.target}`, candidate, job.target_commit]);
      job.status = "integrated"; write(jobFile(r, c, id), job);
      return { ...job, record: integrationPath, next: "Integration is recorded. Milestone-level verification and user acceptance remain separate." };
    } finally { freeSlot(r, c, id); }
  });
}
export function pauseIntegration(project, { id }) {
  return operation(project, r => { const c = configFor(r); streamRoot(parentId(c), id); freeSlot(r, c, id); return { paused: id, next: "Evidence and temporary worktree retained; check current revisions before resuming." }; });
}
export function cleanup(project, { id }) {
  return operation(project, r => {
    const c = configFor(r), m = metadata(r, c, id), target = head(r.root, `refs/heads/${c.target}`);
    assert(!existsSync(sessionPath(r, c, id)), "Release writer session before cleanup");
    if (localMode(c)) acceptance(r, c, m, head(r.root, `refs/heads/${m.branch}`));
    const raw = at(r.root, target, recordPath(c, m, "integration"), true);
    assert(raw && ancestor(r.root, head(r.root, `refs/heads/${m.branch}`), target), "Workstream is not fully integrated with evidence");
    const record = JSON.parse(raw);
    assert(record.checks?.results?.length && record.checks.results.every(x => x.exit_code === 0), "Missing successful checks");
    const paths = worktrees(r.root).filter(w => w.branch === m.branch).map(w => w.path);
    const jobPath = jobFile(r, c, id);
    if (existsSync(jobPath)) {
      const job = readJson(jobPath);
      if (existsSync(job.worktree)) { assert(ancestor(r.root, head(job.worktree), target), "Integration worktree has unmerged commits"); paths.push(job.worktree); }
    }
    for (const path of paths) {
      assert(realpathSync(path) !== realpathSync(r.root), "Cannot remove the invoking worktree; run cleanup from another project worktree");
      clean(path);
      const ignored = git(path, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
      if (localMode(c) && path === worktrees(r.root).find(w => w.branch === m.branch)?.path) {
        const known = new Set([...delivery.inventory(path, unitId(c, id)).map(f => f.path), ...delivery.policy(path).bootstrap_paths]);
        assert(ignored.every(p => known.has(p)), "Unmanaged ignored files present; inspect before cleanup");
        // Preserve current local inputs before removing this completed worktree.
        saveLocalCheckpoint(path, c, id);
      } else assert(!ignored.length, "Ignored local files present; inspect and remove them explicitly before cleanup");
    }
    for (const path of paths) git(r.root, ["worktree", "remove", path]);
    freeSlot(r, c, id);
    return { removed: paths, retained_branch: m.branch, retained_records: m.root };
  });
}
