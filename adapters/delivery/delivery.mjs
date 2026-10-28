import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, readlinkSync, unlinkSync, openSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { assert, git, inside, safePath, readJson, readYaml, worktrees, inheritedWorkstreamStatus } from "../workstreams/context.mjs";

export const POLICY = ".agt/delivery.json";
export const ARCHIVES = ".agt/deliveries";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const head = root => git(root, ["rev-parse", "HEAD"]);
const branch = root => git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true);
const clean = root => assert(!git(root, ["status", "--porcelain"]), "Commit or explicitly resolve working changes before delivery");
export function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(json(value));
  if (existsSync(path) && readFileSync(path).equals(bytes)) return;
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, bytes, { flag: "wx" }); renameSync(temp, path);
}
export function policy(root) {
  if (!existsSync(inside(root, POLICY))) return null;
  const p = readJson(inside(root, POLICY));
  assert((p.schema_version === 2 && p.planning_storage === "branch") || (p.schema_version === 1 && p.planning_storage === "local"), "Invalid delivery policy");
  assert(nonempty(p.adoption_source), "Record delivery adoption source");
  if (p.schema_version === 2) assert(!p.main_branch || /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(p.main_branch), "Invalid main branch");
  assert(safePath(p.deployment_document).startsWith("docs/"), "Deployment instructions must be under docs/");
  return p;
}
function branchPolicy(root) {
  const p = policy(root);
  assert(p?.schema_version === 2, "Adopt schema_version 2 branch planning; legacy local delivery is read-only");
  return p;
}
export function localDirectory(root) { return resolve(root, git(root, ["rev-parse", "--git-common-dir"]), "agt-delivery"); }
export function unitRoot(id) {
  assert(typeof id === "string" && id.length <= 160, "Invalid delivery unit ID");
  const quickChild = /^(Q[0-9]{3,}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*)--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(id);
  if (quickChild) return `.planning/quick/${quickChild[1]}/workstreams/${quickChild[2]}`;
  if (/^Q[0-9]{3,}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) return `.planning/quick/${id}`;
  const m = /^(M[0-9]{3,})(?:-([a-z][a-z0-9]*(?:-[a-z0-9]+)*))?$/.exec(id);
  assert(m, "Use a Quick ID, milestone ID, or parent-workstream ID");
  return `.planning/milestones/${m[1]}${m[2] ? `/workstreams/${m[2]}` : ""}`;
}
export function archiveRoot(id) { unitRoot(id); return `${ARCHIVES}/${id}`; }
export const deliveryRoot = archiveRoot;
export function initialize(root, input) {
  assert(!existsSync(inside(root, POLICY)), "Delivery already initialized; reuse or explicitly migrate its policy");
  assert(input?.schema_version === 2 && input.planning_storage === "branch" && nonempty(input.adoption_source), "Adopt schema_version 2 branch planning");
  assert(safePath(input.deployment_document).startsWith("docs/") && lstatSync(inside(root, input.deployment_document)).isFile(), "Write the deployment document first (unconfigured is allowed)");
  const p = { ...input, main_branch: input.main_branch || "main" };
  assert(git(root, ["check-ref-format", "--branch", p.main_branch], true), "Invalid main branch");
  const ignored = git(root, ["check-ignore", "--no-index", ".planning/agt/project.yaml"], true);
  assert(!ignored, "Remove blanket planning ignore rules before adopting branch planning");
  write(inside(root, POLICY), p);
  return { policy: POLICY, planning_storage: "branch", next: "Commit planning on its milestone/Quick branch; consolidate before final squash into main." };
}
function ownedRoots(id, additional = []) {
  const prefix = unitRoot(id);
  assert(Array.isArray(additional) && new Set(additional).size === additional.length, "Additional roots must be unique explicit paths");
  for (const path of additional) assert(/^M[0-9]{3,}$/.test(id) && new RegExp(`^\\.planning/milestones/${id}-legacy-M[0-9]{3,}$`).test(safePath(path)), "Only established milestone legacy-number roots may be additionally owned");
  return [prefix, ...additional];
}
const belongs = (path, roots) => roots.some(root => path.startsWith(`${root}/`));
export function inventory(root, id, { additional_roots = [] } = {}) {
  const roots = ownedRoots(id, additional_roots), files = [], prefix = unitRoot(id);
  const managed = new Set([`${prefix}/workflow/acceptance.json`, `${prefix}/workflow/integration.json`]);
  function walk(path) {
    if (managed.has(path)) return;
    const full = inside(root, path), stat = lstatSync(full);
    if (stat.isDirectory()) for (const name of readdirSync(full).sort()) walk(`${path}/${name}`);
    else { assert(stat.isFile(), `Not a regular planning file: ${path}`); const bytes = readFileSync(full); files.push({ path, sha256: hash(bytes), bytes: bytes.length }); }
  }
  for (const path of roots) walk(path); return files;
}
function workingChanges(root) {
  const paths = new Set([...git(root, ["diff", "--name-only", "-z", "HEAD"]).split("\0"), ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")].filter(Boolean));
  return [...paths].filter(p => !p.startsWith(".planning/") && !p.startsWith(`${ARCHIVES}/`)).sort().map(path => {
    const stat = lstatSync(resolve(root, safePath(path)), { throwIfNoEntry: false });
    if (!stat) return { path, deleted: true };
    return { path, mode: stat.mode, sha256: hash(stat.isSymbolicLink() ? readlinkSync(resolve(root, path)) : readFileSync(inside(root, path))) };
  });
}
const reviewPath = (root, id) => { unitRoot(id); return resolve(localDirectory(root), "reviews", `${id}.json`); };
function materialFiles(root, id, additional_roots = []) {
  return inventory(root, id, { additional_roots }).filter(f => !/^Q\d+-[^/]+$/.test(id) || id.includes("--") || f.path !== `${unitRoot(id)}/task.json`);
}
export function review(root, id, input) {
  branchPolicy(root);
  assert(nonempty(input.reviewer) && nonempty(input.outcome) && nonempty(input.verification) && nonempty(input.limitations), "Review needs reviewer, outcome, verification and limitations");
  assert(Array.isArray(input.retained_items) && Array.isArray(input.materials), "Declare retained_items and every material disposition");
  for (const item of input.retained_items) assert(nonempty(item.id) && nonempty(item.summary) && nonempty(item.next_action), "Retained items need ID, summary and next action");
  assert(new Set(input.retained_items.map(i => i.id)).size === input.retained_items.length, "Duplicate retained item ID");
  const roots = ownedRoots(id, input.additional_roots);
  const files = materialFiles(root, id, roots.slice(1)), byPath = new Map(input.materials.map(m => [m.path, m]));
  assert(byPath.size === input.materials.length && files.length === byPath.size && files.every(f => byPath.has(f.path)), "Classify every remaining file in this unit exactly once; delete obsolete files before review");
  const materials = files.map(file => {
    const m = byPath.get(file.path);
    assert(["current", "unknown"].includes(m.disposition) && nonempty(m.reason), `Retain current content or resolve unknown purpose; remove obsolete material before review: ${file.path}`);
    const entry = { ...file, disposition: m.disposition, reason: m.reason };
    if (m.target && m.target !== file.path) {
      assert(safePath(m.target).startsWith(".planning/") || m.target.startsWith("docs/"), "Canonical target must be planning or docs");
      entry.target = m.target; entry.target_sha256 = hash(readFileSync(inside(root, m.target)));
    }
    return entry;
  });
  const receipt = { schema_version: 2, id, owned_roots: roots, branch: branch(root), source_commit: head(root), working_changes: workingChanges(root),
    reviewer: input.reviewer, outcome: input.outcome, verification: input.verification, limitations: input.limitations, retained_items: input.retained_items, materials };
  write(reviewPath(root, id), receipt);
  return { id, files: materials.length, unknown: materials.filter(m => m.disposition === "unknown").map(m => m.path), ready: materials.every(m => m.disposition === "current") };
}
export function assertReviewed(root, id) {
  assert(existsSync(reviewPath(root, id)), "Delivery material review required before closeout");
  const r = readJson(reviewPath(root, id));
  assert(r.id === id && r.branch === branch(root) && r.source_commit === head(root), "Delivery review belongs to another branch/commit; review again");
  assert(JSON.stringify(r.working_changes) === JSON.stringify(workingChanges(root)), "Working code/docs changed after delivery review");
  assert(r.materials.every(m => m.disposition === "current"), "Unclassified material blocks closeout; return it to its owner");
  const files = materialFiles(root, id, r.owned_roots?.slice(1));
  assert(files.length === r.materials.length && files.every(f => r.materials.some(m => m.path === f.path && m.sha256 === f.sha256)), "Material changed or added since review; review again");
  for (const m of r.materials.filter(m => m.target)) assert(hash(readFileSync(inside(root, m.target))) === m.target_sha256, `Current document changed: ${m.target}`);
  return r;
}
export function seal(root, id, facts, { required = [], overrides = {}, maintenance } = {}) {
  branchPolicy(root);
  const receipt = assertReviewed(root, id);
  assertWritable(root, receipt.owned_roots || [unitRoot(id)], { maintenance });
  const materials = receipt.materials.map(m => ({ ...m }));
  for (const path of required) assert(safePath(path).startsWith(`${unitRoot(id)}/`) && (materials.some(m => m.path === path) || Object.hasOwn(overrides, path)), `Required current evidence is missing: ${path}`);
  for (const [path, bytes] of Object.entries(overrides)) {
    assert(safePath(path).startsWith(`${unitRoot(id)}/`), "Override outside unit");
    const entry = { path, sha256: hash(Buffer.from(bytes)), bytes: Buffer.byteLength(bytes), disposition: "current", reason: "Final workflow record", automatic: true };
    const index = materials.findIndex(m => m.path === path);
    if (index >= 0) materials[index] = entry; else materials.push(entry);
  }
  const summary = { ...receipt, materials, facts, closed: false, semantic_review: "recorded_by_reviewer", verification_kind: "final_current_content" };
  const path = archiveRoot(id); write(inside(root, `${path}/summary.json`), summary);
  return { path, summary_sha256: hash(Buffer.from(json(summary))), files: materials.length };
}
export function validateSummary(root, id, read) {
  const current = !read;
  read ||= path => readFileSync(inside(root, path));
  const summary = JSON.parse(read(`${archiveRoot(id)}/summary.json`).toString());
  const roots = ownedRoots(id, summary.owned_roots?.slice(1));
  assert(summary.schema_version === 2 && summary.id === id && Array.isArray(summary.materials), "Invalid final delivery summary");
  const files = {};
  for (const m of summary.materials) {
    assert(belongs(safePath(m.path), roots) && m.disposition === "current" && !Object.hasOwn(files, m.path), "Invalid/duplicate final material");
    const bytes = Buffer.from(read(m.path));
    assert(hash(bytes) === m.sha256, `Final material changed: ${m.path}`);
    files[m.path] = bytes.toString("base64");
    if (m.target) assert(hash(read(m.target)) === m.target_sha256, `Final canonical target changed: ${m.target}`);
  }
  if (current) {
    const actual = inventory(root, id, { additional_roots: roots.slice(1) }).map(f => f.path).sort();
    assert(JSON.stringify(actual) === JSON.stringify(Object.keys(files).sort()), "Final scope contains unreviewed or missing material");
  }
  return { summary, files };
}
// Existing callers can retain their reader name; v2 reads plain current files, never an archive.
export function validateArchive(root, id, read) { return validateSummary(root, id, read); }
export function show(root, id) {
  const { summary: s } = validateSummary(root, id);
  const integrationPath = `${archiveRoot(id)}/integration.json`;
  return { id, outcome: s.outcome, verification: s.verification, limitations: s.limitations, retained_items: s.retained_items,
    facts: s.facts, closed: s.closed, source_commit: s.source_commit, files: s.materials.length, path: archiveRoot(id),
    delivery_commit: existsSync(inside(root, integrationPath)) ? git(root, ["log", "-1", "--format=%H", "--", integrationPath]) || null : null };
}
export function gitBytes(root, object) {
  const r = spawnSync("git", ["show", object], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  assert(r.status === 0, `Cannot read Git object ${object}`); return r.stdout;
}
function summaries(root, ref) {
  if (!ref || git(root, ["rev-parse", "--verify", ref], true) === null) return [];
  return git(root, ["ls-tree", "-r", "--name-only", "-z", ref, "--", ARCHIVES]).split("\0").filter(p => p.endsWith("/summary.json")).flatMap(path => {
    const s = JSON.parse(gitBytes(root, `${ref}:${path}`));
    return s.schema_version === 2 && s.closed === true ? [{ ...s, summary_path: path, baseline: ref }] : [];
  });
}
function maintenanceAllowed(root, id, maintenance, base) {
  if (!maintenance) return false;
  assert(nonempty(maintenance.source) && Array.isArray(maintenance.ids) && maintenance.ids.length > 0, "Maintenance needs explicit authorization source and scoped IDs");
  assert(maintenance.branch === branch(root) && maintenance.base_commit === git(root, ["rev-parse", base]), "Maintenance is bound to its branch and baseline");
  return maintenance.ids.includes(id);
}
export function assertWritable(root, paths, { maintenance } = {}) {
  const p = policy(root); if (p?.schema_version !== 2) return;
  const main = p.main_branch || "main";
  const current = [];
  const directory = inside(root, ARCHIVES);
  if (existsSync(directory)) for (const id of readdirSync(directory)) {
    const file = inside(root, `${ARCHIVES}/${id}/summary.json`);
    if (!existsSync(file)) continue;
    const s = readJson(file);
    if (s.schema_version === 2 && s.closed === true) current.push({ ...s, summary_path: `${ARCHIVES}/${id}/summary.json` });
  }
  const closed = [...summaries(root, main), ...summaries(root, "HEAD"), ...current];
  for (const s of closed) if (paths.some(path => {
    safePath(path); const roots = ownedRoots(s.id, s.owned_roots?.slice(1));
    return roots.some(owned => path === owned || path.startsWith(`${owned}/`) || owned.startsWith(`${path}/`)) || path === archiveRoot(s.id) || path.startsWith(`${archiveRoot(s.id)}/`);
  })) assert(maintenanceAllowed(root, s.id, maintenance, main), `Closed delivery is read-only: ${s.id}; use a new milestone/Quick (one-time remediation must be explicitly scoped)`);
}
export function checkGit(root, { staged = false, base, ref = "HEAD", maintenance } = {}) {
  const p = branchPolicy(root), baseline = base || p.main_branch || "main";
  const entries = git(root, staged ? ["ls-files", "-z"] : ["ls-tree", "-r", "--name-only", "-z", ref]).split("\0").filter(Boolean);
  const changed = git(root, staged ? ["diff", "--cached", "--name-only", "-z", baseline] : ["diff", "--name-only", "-z", baseline, ref]).split("\0").filter(Boolean);
  for (const s of summaries(root, baseline)) {
    const roots = ownedRoots(s.id, s.owned_roots?.slice(1));
    if (changed.some(path => path.startsWith(`${archiveRoot(s.id)}/`) || roots.includes(path) || belongs(path, roots))) {
      assert(maintenanceAllowed(root, s.id, maintenance, baseline), `Closed delivery is read-only: ${s.id}`);
      const updated = JSON.parse(gitBytes(root, `${staged ? "" : ref}:${s.summary_path}`));
      assert(updated.closed === true && updated.id === s.id, `Maintenance must leave ${s.id} closed`);
    }
  }
  const ids = entries.filter(path => path.startsWith(`${ARCHIVES}/`) && path.endsWith("/summary.json")).map(path => path.slice(ARCHIVES.length + 1).split("/")[0]);
  for (const id of ids) {
    const stored = JSON.parse(gitBytes(root, `${staged ? "" : ref}:${archiveRoot(id)}/summary.json`));
    if (stored.schema_version === 1) {
      assert(!changed.some(path => path.startsWith(`${archiveRoot(id)}/`)), "Legacy delivery is read-only; migrate explicitly");
      continue;
    }
    const { files, summary } = validateSummary(root, id, path => gitBytes(root, `${staged ? "" : ref}:${path}`));
    const prefix = unitRoot(id), managed = [`${prefix}/workflow/acceptance.json`, `${prefix}/workflow/integration.json`];
    const roots = ownedRoots(id, summary.owned_roots?.slice(1));
    const actual = entries.filter(path => belongs(path, roots) && !managed.includes(path)).sort();
    assert(JSON.stringify(actual) === JSON.stringify(Object.keys(files).sort()), `Final scope contains unreviewed or missing material: ${id}`);
  }
  return { pass: true, scope: staged ? "index" : ref, baseline, deliveries: ids.length, planning_storage: "branch" };
}
function parentBranch(id) { unitRoot(id); assert(/^M\d+$/.test(id) || (/^Q\d+-/.test(id) && !id.includes("--")), "Final delivery requires a milestone or independent Quick"); return id.startsWith("M") ? `milestone/${id}` : `quick/${id}`; }
export function start(root, { id, path, predecessor = null, approval }) {
  const p = branchPolicy(root), main = p.main_branch || "main", name = parentBranch(id);
  assert(nonempty(approval) && path, "Record start authorization and a new worktree path");
  assert(!existsSync(resolve(path)), "Worktree destination already exists");
  const base = git(root, ["rev-parse", `refs/heads/${main}`]);
  assert(!summaries(root, main).some(s => s.id === id), "This delivery is already closed; use a new ID");
  if (id.startsWith("M") && Number(id.slice(1)) > 1) {
    const expected = `M${String(Number(id.slice(1)) - 1).padStart(id.length - 1, "0")}`;
    assert(predecessor === expected, `Milestone must inherit completed ${expected}`);
  }
  if (predecessor) assert(summaries(root, main).some(s => s.id === predecessor), `Predecessor is not closed on ${main}: ${predecessor}`);
  assert(!git(root, ["show-ref", "--verify", `refs/heads/${name}`], true), "Delivery branch already exists; resume it");
  git(root, ["worktree", "add", "-b", name, resolve(path), base]);
  const record = { schema_version: 2, id, branch: name, parent_branch: main, base_commit: base, predecessor, authorization: approval };
  write(inside(resolve(path), `${unitRoot(id)}/branch.json`), record);
  return { ...record, worktree: resolve(path), next: "Commit the scoped branch record with its task setup; do not modify predecessor documents." };
}
// A parent can replace accepted child process files with its reviewed final content.
// The ordinary integration receipt remains; no copy of retired process material is made.
export function consolidate(root, { id, child, reason }) {
  branchPolicy(root);
  assert(branch(root) === parentBranch(id) && nonempty(reason), "Consolidation needs its parent branch and semantic reason");
  const prefix = id.startsWith("Q") ? `${id}--` : `${id}-`;
  assert(child?.startsWith(prefix), "Child delivery belongs to another parent");
  const slug = child.slice(prefix.length), childBranch = `agt/${id}/${slug}`;
  unitRoot(child);
  const source = git(root, ["rev-parse", `refs/heads/${childBranch}`]);
  assert(git(root, ["merge-base", "--is-ancestor", source, "HEAD"], true) !== null, "Child must be fully integrated before consolidation");
  const accepted = validateSummary(root, child, path => gitBytes(root, `${source}:${path}`)).summary;
  assert(accepted.facts?.status === "accepted", "Child acceptance is required before consolidation");
  const { summary } = validateSummary(root, id);
  assert(!summary.closed, "Parent is already closed");
  const integration = `${unitRoot(child)}/workflow/integration.json`;
  assert(existsSync(inside(root, integration)), "Keep the minimal child integration receipt");
  summary.facts ||= {};
  summary.facts.consolidated_workstreams = [...(summary.facts.consolidated_workstreams || []).filter(c => c.id !== child), { id: child, source_commit: source, reason }];
  const childSummary = inside(root, `${archiveRoot(child)}/summary.json`);
  if (existsSync(childSummary)) unlinkSync(childSummary);
  write(inside(root, `${archiveRoot(id)}/summary.json`), summary);
  return { id, child, source_commit: source, current_content: `${archiveRoot(id)}/summary.json`, integration };
}
const jobPath = (root, id) => { parentBranch(id); return resolve(localDirectory(root), "squash", `${id}.json`); };
function checkFresh(root, job) {
  assert(git(root, ["rev-parse", `refs/heads/${job.source_branch}`]) === job.source_commit, "Source changed; prepare and verify a new candidate");
  assert(git(root, ["rev-parse", `refs/heads/${job.target_branch}`]) === job.target_commit, "Main changed; prepare and verify a new candidate");
  assert(head(job.worktree) === job.candidate_commit, "Candidate changed; prepare and verify again"); clean(job.worktree);
}
function assertReviewedCode(root, summary) {
  assert(git(root, ["merge-base", "--is-ancestor", summary.source_commit, "HEAD"], true) !== null, "Acceptance source is not an ancestor of this branch");
  const changes = git(root, ["diff", "--name-only", "-z", summary.source_commit, "HEAD"]).split("\0").filter(path => path && !path.startsWith(".planning/") && !path.startsWith(`${ARCHIVES}/`));
  const expected = new Map((summary.working_changes || []).map(entry => [entry.path, entry]));
  for (const path of changes) assert(expected.has(path), `Code changed after acceptance: ${path}`);
  for (const [path, entry] of expected) {
    const stat = lstatSync(resolve(root, path), { throwIfNoEntry: false });
    if (entry.deleted) assert(!stat, `Deleted reviewed file was restored: ${path}`);
    else {
      assert(stat, `Reviewed file is missing: ${path}`);
      const bytes = stat.isSymbolicLink() ? readlinkSync(resolve(root, path)) : readFileSync(inside(root, path));
      assert(hash(bytes) === entry.sha256 && stat.mode === entry.mode, `Code changed after acceptance: ${path}`);
    }
  }
}
function assertFinalPlanningScope(candidate, id, base, authorizationRoot, maintenance) {
  const entries = git(candidate, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const allowed = new Set([unitRoot(id)]);
  for (const path of entries.filter(path => path.startsWith(`${ARCHIVES}/`) && path.endsWith("/summary.json"))) {
    const summary = JSON.parse(gitBytes(candidate, `:${path}`));
    if (summary.schema_version !== 2 || !summary.closed) continue;
    validateSummary(candidate, summary.id, file => gitBytes(candidate, `:${file}`));
    for (const owned of ownedRoots(summary.id, summary.owned_roots?.slice(1))) allowed.add(owned);
  }
  const changed = git(candidate, ["diff", "--cached", "--no-renames", "--name-only", "-z", base]).split("\0").filter(Boolean);
  const roots = new Set(changed.map(path => /^(\.planning\/(?:milestones|quick)\/[^/]+)(?:\/|$)/.exec(path)?.[1]).filter(Boolean));
  for (const scope of roots) {
    if (allowed.has(scope)) continue;
    const survives = entries.some(path => path === scope || path.startsWith(`${scope}/`));
    assert(!survives, `Unfinished unrelated planning cannot enter main: ${scope}`);
    const removedId = scope.split("/").at(-1);
    assert(maintenanceAllowed(authorizationRoot, removedId, maintenance, base), `Whole-unit removal needs explicit migration authorization: ${removedId}`);
  }
}
export function prepare(root, { id, maintenance }) {
  const p = branchPolicy(root), source = parentBranch(id), target = p.main_branch || "main";
  assert(branch(root) === source, `Run final delivery in ${source}`); clean(root);
  const { summary } = validateSummary(root, id);
  const binding = inside(root, ".planning/agt/workstreams.json");
  if (existsSync(binding)) {
    const config = readJson(binding);
    for (const inherited of config.inherited_workstreams || []) {
      const status = inheritedWorkstreamStatus(root, config, inherited, "HEAD");
      assert(status.integrated, `Inherited workstream changed since adoption: ${inherited.id}`);
    }
  }
  assert(summary.facts?.status === "accepted" || summary.facts?.status === "complete", "Final acceptance is required before squash preparation");
  assertReviewedCode(root, summary);
  for (const child of git(root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/agt/${id}/`]).split("\n").filter(Boolean)) {
    assert(git(root, ["merge-base", "--is-ancestor", child, "HEAD"], true) !== null, `Child workstream has unintegrated changes: ${child}`);
  }
  const sourceCommit = head(root), targetCommit = git(root, ["rev-parse", `refs/heads/${target}`]);
  checkGit(root, { base: target, maintenance });
  const old = existsSync(jobPath(root, id)) ? readJson(jobPath(root, id)) : null;
  if (old?.source_commit === sourceCommit && old.target_commit === targetCommit && existsSync(old.worktree)) { checkFresh(root, old); return old; }
  const path = resolve(localDirectory(root), "candidates", `${id}-${randomUUID()}`);
  git(root, ["worktree", "add", "--detach", path, targetCommit]);
  const result = spawnSync("git", ["merge", "--squash", "--no-commit", sourceCommit], { cwd: path, encoding: "utf8" });
  assert(result.status === 0, `Squash conflict retained at ${path}; resolve explicitly before preparing a fresh candidate: ${result.stderr}`);
  // Live workstream binding belongs to the parent branch, never to main.
  for (const configPath of [".planning/agt/workstreams.json", ".agt/workstreams.json"]) {
    if (!existsSync(inside(path, configPath))) continue;
    const config = readJson(inside(path, configPath));
    if (config.target === source) { unlinkSync(inside(path, configPath)); git(path, ["add", "-u", "--", configPath]); }
  }
  const final = { ...summary, closed: true, review_commit: summary.source_commit, source_commit: sourceCommit, target_base: targetCommit };
  write(inside(path, `${archiveRoot(id)}/summary.json`), final);
  write(inside(path, `${archiveRoot(id)}/integration.json`), { schema_version: 2, id, method: "squash", source_branch: source, source_commit: sourceCommit, target_branch: target, target_base: targetCommit });
  git(path, ["add", "--", `${archiveRoot(id)}/summary.json`, `${archiveRoot(id)}/integration.json`]);
  assertFinalPlanningScope(path, id, targetCommit, root, maintenance);
  git(path, ["commit", "-m", `deliver: ${id}`]);
  const job = { schema_version: 2, id, source_branch: source, source_commit: sourceCommit, target_branch: target, target_commit: targetCommit, worktree: path, candidate_commit: head(path), status: "prepared", maintenance: maintenance || null };
  // Check candidate contents against the exact target. Scoped remediation is checked on the source branch above.
  for (const delivery of summaries(path, "HEAD")) validateSummary(path, delivery.id);
  write(jobPath(root, id), job); return job;
}
export function verify(root, { id, commands, reviewer, approval }) {
  const job = readJson(jobPath(root, id)); checkFresh(root, job);
  assert(nonempty(reviewer) && nonempty(approval) && Array.isArray(commands) && commands.length > 0 && commands.every(c => Array.isArray(c) && c.length && c.every(nonempty)), "Provide reviewer, acceptance source and explicit check argv arrays");
  const checks = commands.map(argv => { const r = spawnSync(argv[0], argv.slice(1), { cwd: job.worktree, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 }); return { argv, status: r.status, error: r.error?.message || null }; });
  checkFresh(root, job);
  const pass = checks.every(c => c.status === 0 && !c.error);
  Object.assign(job, { status: pass ? "verified" : "failed", verification: { candidate_commit: job.candidate_commit, reviewer, approval, checks } });
  write(jobPath(root, id), job); assert(pass, "Candidate checks failed; inspect and fix the affected task before delivery"); return job;
}
export function finish(root, { id }) {
  const lockPath = resolve(localDirectory(root), "squash-write.lock");
  mkdirSync(dirname(lockPath), { recursive: true });
  let lock;
  try { lock = openSync(lockPath, "wx"); }
  catch (error) { if (error.code === "EEXIST") throw Error(`Delivery update is locked; inspect live owner before recovery: ${lockPath}`); throw error; }
  try {
    writeFileSync(lock, json({ pid: process.pid, id }));
    const job = readJson(jobPath(root, id));
    // A process may stop after the main update but before saving its local receipt.
    if (["publishing", "delivered"].includes(job.status) && git(root, ["merge-base", "--is-ancestor", job.candidate_commit, job.target_branch], true) !== null) {
      Object.assign(job, { status: "delivered", delivery_commit: job.candidate_commit }); write(jobPath(root, id), job); return job;
    }
    checkFresh(root, job);
    assert(["verified", "publishing"].includes(job.status) && job.verification?.candidate_commit === job.candidate_commit, "Successful checks for this exact candidate are required");
    const target = worktrees(root).find(w => w.branch === job.target_branch);
    if (target) { clean(target.path); assert(branch(target.path) === job.target_branch, "Target checkout changed branch"); }
    job.status = "publishing"; write(jobPath(root, id), job);
    assert(git(root, ["rev-parse", `refs/heads/${job.target_branch}`]) === job.target_commit, "Main changed before update; prepare and verify again");
    if (target) git(target.path, ["merge", "--ff-only", job.candidate_commit]);
    else git(root, ["update-ref", `refs/heads/${job.target_branch}`, job.candidate_commit, job.target_commit]);
    Object.assign(job, { status: "delivered", delivery_commit: job.candidate_commit }); write(jobPath(root, id), job); return job;
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

// One-time, explicitly scoped cleanup of already accepted legacy milestones.
// This records the old acceptance; it does not claim a new business or QA decision.
export function adoptClosed(root, id, input) {
  const p = branchPolicy(root), main = p.main_branch || "main";
  assert(/^M[0-9]{3,}$/.test(id) || (/^Q[0-9]{3,}-/.test(id) && !id.includes("--")), "Historical adoption requires a milestone or completed Quick ID");
  assert(maintenanceAllowed(root, id, input?.maintenance, main), "Explicit one-time milestone maintenance authorization is required");
  if (id.startsWith("Q")) {
    const taskPath = `${unitRoot(id)}/task.json`, declared = input.original_completion || {};
    assert(!declared.path || declared.path === taskPath, "Historical completion must use this Quick task record");
    const bytes = declared.commit ? gitBytes(root, `${declared.commit}:${taskPath}`) : readFileSync(inside(root, taskPath));
    const previous = JSON.parse(bytes);
    assert(previous.id === id && previous.status === "complete", "Only an already completed Quick may be imported; active or unverified work stays open");
    const receipt = assertReviewed(root, id);
    const origin = { path: taskPath, sha256: hash(bytes), ...(declared.commit ? { commit: declared.commit } : { source: "working_tree_completed_record" }) };
    const task = { schema_version: 2, id, title: previous.title, request: previous.request, status: "complete", branch: previous.branch,
      milestone: previous.milestone ?? null, summary: receipt.outcome, next_action: null, completion_kind: "historical_completion_preserved",
      original_completion: origin, verification: receipt.verification, limitations: receipt.limitations, retained_items: receipt.retained_items };
    const result = seal(root, id, { kind: "quick", status: "complete", historical: true, original_completion: origin, remediation_source: input.maintenance.source },
      { maintenance: input.maintenance, overrides: { [taskPath]: json(task) } });
    write(inside(root, taskPath), task);
    const summaryPath = inside(root, `${result.path}/summary.json`), summary = readJson(summaryPath);
    summary.closed = true; summary.verification_kind = "historical_completion_preserved";
    write(summaryPath, summary); validateSummary(root, id);
    return { ...result, summary_sha256: hash(readFileSync(summaryPath)), closed: true, original_completion: origin, new_business_acceptance: false, tests_reexecuted: false };
  }
  const original = input.original_acceptance;
  assert(original && /^[a-f0-9]{40,64}$/.test(original.commit) && nonempty(original.path), "Record original acceptance commit and path");
  assert(safePath(original.path).startsWith(`${unitRoot(id)}/`), "Original acceptance belongs to this milestone");
  const acceptedBytes = gitBytes(root, `${original.commit}:${original.path}`);
  if (Number(id.slice(1)) > 1) {
    const expected = `M${String(Number(id.slice(1)) - 1).padStart(id.length - 1, "0")}`;
    assert(input.predecessor === expected, `Historical milestone inherits ${expected}`);
    const preceding = readJson(inside(root, `${archiveRoot(expected)}/summary.json`));
    assert(preceding.closed === true, "Restore predecessor's closed baseline first");
  }
  const receipt = assertReviewed(root, id);
  assert(JSON.stringify(ownedRoots(id, input.additional_roots)) === JSON.stringify(receipt.owned_roots), "Review the same explicitly owned legacy roots before historical adoption");
  const result = seal(root, id, { kind: "milestone", status: "accepted", historical: true, predecessor: input.predecessor || null,
    original_acceptance: { ...original, sha256: hash(acceptedBytes) }, remediation_source: input.maintenance.source }, { maintenance: input.maintenance });
  const summaryPath = inside(root, `${result.path}/summary.json`), summary = readJson(summaryPath);
  summary.closed = true; summary.verification_kind = "historical_acceptance_preserved";
  write(summaryPath, summary); validateSummary(root, id);
  return { ...result, summary_sha256: hash(readFileSync(summaryPath)), closed: true, original_acceptance: original, new_business_acceptance: false };
}
export function close(root, id, input) {
  const scope = unitRoot(id);
  assert(input?.approval && Array.isArray(input.evidence) && input.evidence.length, "Final approval and current evidence are required");
  if (/^M\d+$/.test(id)) {
    const state = readYaml(inside(root, ".planning/workflow/state.yaml"));
    assert(state.milestone === id && ["milestone-complete", "complete", "completed"].includes(state.stage) && !state.pending_user_decisions?.length && !state.open_change_requests?.length, "Milestone must have final acceptance with no open blockers");
  }
  for (const path of [input.approval, ...input.evidence]) assert(safePath(path).startsWith(`${scope}/`), "Final acceptance belongs to this delivery");
  return seal(root, id, { kind: id.startsWith("M") ? "milestone" : "quick", status: "accepted", approval: input.approval, evidence: input.evidence }, { required: [input.approval, ...input.evidence], maintenance: input.maintenance });
}
// Legacy exports remain explicit read-only recovery; v2 never creates compressed copies.
export function extract(root, id, destination) {
  const base = archiveRoot(id), s = readJson(inside(root, `${base}/summary.json`));
  assert(s.schema_version === 1, "Branch delivery has no archive; use Git to read the closed milestone");
  const bytes = readFileSync(inside(root, `${base}/archive.json.gz`)); assert(hash(bytes) === s.archive_sha256, "Legacy archive damaged");
  const a = JSON.parse(gunzipSync(bytes)); assert(a.id === id && a.files, "Invalid legacy archive");
  assert(!existsSync(resolve(destination)), "Recovery destination must be new"); mkdirSync(resolve(destination), { recursive: true });
  for (const [path, data] of Object.entries(a.files)) { assert(safePath(path).startsWith(`${unitRoot(id)}/`), "Legacy archive path outside scope"); write(inside(resolve(destination), path), Buffer.from(data, "base64")); }
  return { destination: resolve(destination), files: Object.keys(a.files).length };
}
export function checkpoint() { throw Error("Local planning checkpoints retired; commit current planning on its task branch"); }
export function checkpointFiles() { throw Error("Legacy checkpoint recovery requires its pinned legacy tool"); }
export function restoreCheckpoint() { throw Error("Branch planning is restored from its task branch; legacy recovery uses its pinned tool"); }
