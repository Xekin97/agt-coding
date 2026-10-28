import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { hostname } from "node:os";
import * as delivery from "../delivery/delivery.mjs";
import { resolveContext, parentId } from "../workstreams/context.mjs";
import * as streams from "../workstreams/workstreams.mjs";

const branchMode = root => delivery.policy(root)?.schema_version === 2;
const ROOT = ".planning/quick";
const CONFIG = ".planning/agt/quick-tasks.json";
const terminal = new Set(["complete", "escalated", "cancelled"]);
const statuses = new Set(["planned", "active", "blocked", ...terminal]);
const documentRoles = {
  product: ["product/to-c", "product/to-b"], design: ["uiux/base"],
  technical: ["dba/base", "backend-architect/base", "frontend-architect/base"],
  verification: ["quality/base"],
  handoff: ["backend-implementer/base", "frontend-implementer/base", "quality/base", "gatekeeper"],
};
const upstreamDomains = ["product", "design", "technical"];
const definitionKeys = ["title", "request", "executor", "milestone", "sources", "write_scope", "plan", "acceptance", "document_impacts", "document_tasks"];
const assert = (ok, message) => { if (!ok) throw Error(message); };
const text = value => typeof value === "string" && value.trim().length > 0;
const hash = value => createHash("sha256").update(value).digest("hex");
const json = file => JSON.parse(readFileSync(file, "utf8"));
const now = () => new Date().toISOString();
function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert(r.status === 0, r.stderr || r.error?.message || "Git command failed");
  return r.stdout.trim();
}
function pathAt(root, path) {
  assert(text(path) && !isAbsolute(path) && !/[\\\0\r\n]/.test(path) && !path.split("/").some(p => ["", ".", "..", ".git"].includes(p)), `Unsafe path: ${path}`);
  let full = root;
  for (const part of path.split("/")) {
    full = join(full, part);
    assert(!lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink(), `Symlink in path: ${path}`);
  }
  return full;
}
function context(project, writing = false) {
  const root = realpathSync(git(resolve(project), ["rev-parse", "--show-toplevel"]));
  const config = json(pathAt(root, CONFIG));
  assert(config.schema_version === 1 && config.enabled === true && text(config.adoption_source), "Quick tasks need explicit adoption");
  assert(existsSync(pathAt(root, ".planning/agt/project.yaml")) && existsSync(pathAt(root, ".planning/workflow/state.yaml")), "Missing AGT project/state");
  if (writing) {
    const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (existsSync(pathAt(root, ".planning/agt/workstreams.json")) || existsSync(pathAt(root, ".agt/workstreams.json"))) {
      assert(branchMode(root), "Quick writes do not support legacy workstreams; use the requirement workflow and lease");
      const ctx = resolveContext(root);
      assert(branchMode(root) && ctx.mode === "coordinator" && ctx.config.parent?.kind === "quick", "Quick writes require their own parent; use the requirement workflow and lease in children");
    }
    assert(!branch.startsWith("agt/"), "Workstream binding must not fall back to Quick");
    if (branchMode(root)) assert(branch.startsWith("quick/"), "Quick writes require the owning quick/<ID> branch, never main");
    return { root, branch };
  }
  return { root };
}
function locked(project, fn) {
  const ctx = context(project, true);
  const lock = resolve(ctx.root, git(ctx.root, ["rev-parse", "--git-path", "agt-quick.lock"]));
  let fd;
  try { fd = openSync(lock, "wx"); }
  catch (error) { if (error.code === "EEXIST") throw Error(`Quick write locked: inspect owner in ${lock}; never remove a live owner's lock`); throw error; }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), started: now() }));
    return fn(ctx);
  } finally { closeSync(fd); unlinkSync(lock); }
}
function taskPath(root, id) {
  assert(/^Q[0-9]{3,}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) && id.length <= 90, "Invalid Quick task ID");
  return pathAt(root, `${ROOT}/${id}/task.json`);
}
function specCheck(root, s, requireSources = true) {
  for (const key of ["title", "request", "executor"]) assert(text(s[key]), `Missing ${key}`);
  assert(s.milestone === null || /^M[0-9]{3,}$/.test(s.milestone), "milestone must be null or an M ID");
  for (const key of ["sources", "write_scope", "plan", "acceptance"]) assert(Array.isArray(s[key]) && s[key].length > 0, `Missing ${key}`);
  assert(s.plan.every(text), "Plan must contain nonempty steps");
  for (const source of s.sources) {
    assert(text(source), "Source path required");
    const full = pathAt(root, source.split("#")[0]);
    if (requireSources) assert(existsSync(full) && lstatSync(full).isFile(), `Missing source file: ${source}`);
  }
  for (const path of s.write_scope) {
    const full = pathAt(root, path);
    assert(!/^(?:\.planning\/(?:quick(?:\/|$)|workflow(?:\/|$)|agt\/(?:project\.yaml|agents\.yaml|quick-tasks\.json)$))/.test(path), `Quick cannot own workflow/control records: ${path}`);
    assert(!existsSync(full) || lstatSync(full).isFile(), `Scope must name files, not directories: ${path}`);
  }
  assert(new Set(s.write_scope).size === s.write_scope.length, "Duplicate scope path");
  assert(s.acceptance.every(x => x && /^[A-Z][A-Z0-9_-]*$/.test(x.id) && text(x.description) && ["command", "inspection", "manual"].includes(x.verification)), "Acceptance requires IDs, descriptions and command/inspection/manual verification");
  assert(new Set(s.acceptance.map(x => x.id)).size === s.acceptance.length, "Duplicate acceptance ID");
  documentPlanCheck(root, s);
}
function documentPlanCheck(root, s) {
  assert(s.document_impacts && Array.isArray(s.document_tasks), "Document impact assessment and document_tasks are required");
  for (const domain of Object.keys(documentRoles)) {
    const impact = s.document_impacts[domain];
    assert(impact && ["affected", "none"].includes(impact.status) && text(impact.reason), `Assess ${domain} document impact with a reason`);
    const jobs = s.document_tasks.filter(d => d.domain === domain);
    assert(impact.status === "affected" ? jobs.length > 0 : jobs.length === 0, `Document routing does not match ${domain} impact`);
  }
  const ids = new Set(s.document_tasks.map(d => d.id));
  assert(ids.size === s.document_tasks.length, "Duplicate document task ID");
  for (const d of s.document_tasks) {
    assert(/^[A-Z][A-Z0-9_-]*$/.test(d.id) && documentRoles[d.domain]?.includes(d.role) && text(d.change), "Invalid document task role/domain/change");
    assert(Array.isArray(d.paths) && d.paths.length > 0 && d.paths.every(p => s.write_scope.includes(p)), "Document paths must be in write_scope");
    for (const p of d.paths) {
      pathAt(root, p);
      assert(!/^\.planning\/quick\//.test(p) && !p.split("/").some(x => ["reviews", "evidence", "decisions"].includes(x)), "Use canonical mutable documents, not frozen approvals/evidence or Quick summaries");
    }
    assert(Array.isArray(d.depends_on) && d.depends_on.every(id => ids.has(id) && id !== d.id), "Invalid document dependency");
    assert(typeof d.approval_required === "boolean" && (d.approval_source === null || text(d.approval_source)), "Declare document approval requirement/source");
    if (d.approval_source && d.approval_source !== "task.request") pathAt(root, d.approval_source);
  }
  const ancestors = (id, chain = new Set()) => {
    assert(!chain.has(id), "Document dependency cycle");
    const next = new Set([...chain, id]), all = new Set();
    for (const dep of s.document_tasks.find(d => d.id === id).depends_on) {
      all.add(dep); for (const other of ancestors(dep, next)) all.add(other);
    }
    return all;
  };
  const order = Object.keys(documentRoles);
  for (const d of s.document_tasks) {
    const required = s.document_tasks.filter(other => order.indexOf(other.domain) < order.indexOf(d.domain));
    const actual = ancestors(d.id);
    assert(required.every(other => actual.has(other.id)), `Document task ${d.id} must depend on affected upstream documents`);
  }
}
function load(root, id, branch) {
  const task = json(taskPath(root, id));
  assert(task.completion_kind !== "historical_completion_preserved", "Historical completed Quick is immutable; use show/resume or create a new task");
  assert(task.schema_version === 1 && task.id === id && statuses.has(task.status), "Invalid Quick record");
  assert(Number.isInteger(task.revision) && task.revision > 0 && Number.isInteger(task.plan_revision) && task.plan_revision > 0 && Array.isArray(task.checks), "Invalid Quick revisions/checks");
  specCheck(root, task, !!branch);
  if (branch && branchMode(root)) {
    assert(branch === `quick/${task.id}`, "Quick task must use its own delivery branch");
    delivery.assertWritable(root, [...task.write_scope, `${ROOT}/${task.id}/task.json`]);
    if (existsSync(pathAt(root, ".planning/agt/workstreams.json"))) {
      const ctx = resolveContext(root);
      assert(parentId(ctx.config) === task.id, "Quick parent binding mismatch");
    }
  }
  if (branch) assert(task.branch === branch, `Task belongs to branch ${task.branch}; do not resume writes on ${branch}`);
  return task;
}
function save(root, task, beforeWrite) {
  const file = taskPath(root, task.id);
  assert(json(file).revision === task.revision, "Task changed during operation; reload before writing");
  task.revision += 1;
  task.updated_at = now();
  if (beforeWrite) beforeWrite();
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(task, null, 2) + "\n", { flag: "wx" });
  renameSync(temp, file);
  return task;
}
function fileDigest(root, path) {
  const full = pathAt(root, path);
  if (!existsSync(full)) return null;
  assert(lstatSync(full).isFile(), `Not a regular file: ${path}`);
  return hash(Buffer.concat([Buffer.from(String(lstatSync(full).mode & 0o777)), readFileSync(full)]));
}
function fingerprint(root, task) {
  // Reporting existing results must not force an otherwise unchanged test rerun.
  const reports = new Set(task.document_tasks.filter(d => !upstreamDomains.includes(d.domain)).flatMap(d => d.paths));
  const paths = [...new Set([...task.write_scope, ...task.sources.map(s => s.split("#")[0]), ...task.document_tasks.map(d => d.approval_source).filter(p => p && p !== "task.request"), CONFIG, ".planning/agt/project.yaml", ".planning/workflow/state.yaml"])].filter(p => !reports.has(p)).sort();
  const definition = Object.fromEntries([...definitionKeys, "plan_revision"].map(k => [k, task[k]]));
  return hash(JSON.stringify({ definition, files: paths.map(p => [p, fileDigest(root, p)]) }));
}
function evidence(root, paths, task) {
  assert(Array.isArray(paths) && paths.length > 0, "Evidence paths required");
  return paths.map(path => {
    assert(!task || path !== `${ROOT}/${task.id}/task.json`, "Evidence cannot reference its own mutable task record");
    const digest = fileDigest(root, path);
    assert(digest !== null, `Missing evidence: ${path}`);
    if (!task || branchMode(root)) return { path, digest };
    const bytes = readFileSync(pathAt(root, path)), sha256 = hash(bytes);
    // Keep immutable command logs in place; snapshot other evidence once per content.
    let snapshot = path;
    if (!path.startsWith(`${ROOT}/${task.id}/check-`) || !/^check-[0-9]+\.json$/.test(path.split("/").at(-1))) {
      snapshot = `${ROOT}/${task.id}/evidence/${sha256}`;
      mkdirSync(dirname(pathAt(root, snapshot)), { recursive: true });
      if (!existsSync(pathAt(root, snapshot))) writeFileSync(pathAt(root, snapshot), bytes, { flag: "wx" });
      assert(hash(readFileSync(pathAt(root, snapshot))) === sha256, "Original evidence snapshot changed");
    }
    return { path, digest, original: { snapshot, sha256 } };
  });
}
function criteria(task, ids, method) {
  assert(Array.isArray(ids) && ids.length > 0 && ids.every(id => task.acceptance.some(a => a.id === id && a.verification === method)), "Unknown acceptance ID or verification method mismatch");
}
function active(task) { assert(task.status === "active", "Task must be active"); }
function captureDocumentBaselines(root, task) {
  task.document_baselines ||= [];
  for (const path of new Set(task.document_tasks.flatMap(d => d.paths))) {
    if (task.document_baselines.some(b => b.path === path)) continue;
    const digest = fileDigest(root, path);
    let original = null;
    if (digest !== null && !branchMode(root)) {
      const bytes = readFileSync(pathAt(root, path));
      const previous = spawnSync("git", ["show", `${task.base_commit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      if (previous.status === 0 && previous.stdout.equals(bytes)) original = { git_revision: task.base_commit, path, sha256: hash(bytes) };
      else {
        const snapshot = `${ROOT}/${task.id}/originals/${path}`;
        mkdirSync(dirname(pathAt(root, snapshot)), { recursive: true });
        writeFileSync(pathAt(root, snapshot), bytes, { flag: "wx" });
        original = { snapshot, sha256: hash(bytes) };
      }
    }
    task.document_baselines.push({ path, digest, original });
  }
}
function approvalDigest(root, task, d) {
  if (d.approval_source === "task.request") return hash(task.request);
  return d.approval_source ? fileDigest(root, d.approval_source) : null;
}
function documentSignature(root, task, d) {
  const allDocuments = new Set(task.document_tasks.flatMap(job => job.paths));
  const paths = new Set([
    ...d.paths,
    ...d.depends_on.flatMap(id => task.document_tasks.find(job => job.id === id).paths),
    ...task.sources.map(s => s.split("#")[0]).filter(p => !allDocuments.has(p)),
    CONFIG, ".planning/agt/project.yaml", ".planning/workflow/state.yaml",
    ...(!upstreamDomains.includes(d.domain) ? task.write_scope.filter(p => !allDocuments.has(p)) : []),
  ]);
  return hash(JSON.stringify({ definition: Object.fromEntries([...definitionKeys, "plan_revision"].map(k => [k, task[k]])), approval: approvalDigest(root, task, d), files: [...paths].sort().map(p => [p, fileDigest(root, p)]) }));
}
function documentStatus(root, task) {
  if (branchMode(root) && task.status === "complete" && task.final_validation) return task.final_validation.documents;
  const cache = new Map();
  const resolveJob = d => {
    if (cache.has(d.id)) return cache.get(d.id);
    const receipt = (task.document_receipts || []).findLast(r => r.document === d.id);
    const dependencies = d.depends_on.every(id => resolveJob(task.document_tasks.find(job => job.id === id)).pass);
    const changed = d.paths.every(p => {
      const baseline = task.document_baselines?.find(b => b.path === p), current = fileDigest(root, p);
      return baseline && current !== null && current !== baseline.digest;
    });
    const approved = !d.approval_required || approvalDigest(root, task, d) !== null;
    const fresh = receipt?.status === "pass" && receipt.signature === documentSignature(root, task, d) && receipt.evidence.every(e => fileDigest(root, e.path) === e.digest);
    const pass = !!(dependencies && changed && approved && fresh);
    const result = { id: d.id, domain: d.domain, role: d.role, pass, reason: !approved ? "approval_missing" : !dependencies ? "upstream_pending_or_stale" : !changed ? "canonical_writeback_missing" : !fresh ? "owner_receipt_missing_or_stale" : "current" };
    cache.set(d.id, result); return result;
  };
  return task.document_tasks.map(resolveJob);
}
function requireUpstreamDocuments(root, task) {
  const pending = documentStatus(root, task).filter(d => upstreamDomains.includes(d.domain) && !d.pass);
  assert(!pending.length, `Upstream document reconciliation required: ${pending.map(d => d.id).join(", ")}`);
}
function validChecks(root, task) {
  if (branchMode(root) && task.status === "complete" && task.final_validation) return task.final_validation.checks.map(c => ({ ...c,
    pass: c.pass && c.evidence.every(e => fileDigest(root, e.path) === e.digest),
    current_evidence: c.evidence.every(e => fileDigest(root, e.path) === e.digest) }));
  const current = fingerprint(root, task);
  const latest = new Map();
  for (const check of task.checks) for (const id of check.criteria) latest.set(id, check);
  return task.acceptance.map(a => {
    const check = latest.get(a.id);
    const pass = check?.status === "pass" && check.fingerprint === current && check.evidence.length > 0 && check.evidence.every(e => fileDigest(root, e.path) === e.digest);
    return { id: a.id, pass, last_status: check?.status || "not_run", current_evidence: !!pass };
  });
}
function closeoutSignature(root, task) {
  return hash(JSON.stringify({ fingerprint: fingerprint(root, task),
    scope: task.write_scope.map(p => [p, fileDigest(root, p)]),
    checks: task.checks, receipts: task.document_receipts, progress: task.progress }));
}
function originalIntact(root, original) {
  if (original.snapshot) {
    const full = pathAt(root, original.snapshot);
    return existsSync(full) && hash(readFileSync(full)) === original.sha256;
  }
  const r = spawnSync("git", ["show", `${original.git_revision}:${original.path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 && hash(r.stdout) === original.sha256;
}
function archiveIntact(root, task) {
  if (branchMode(root)) return true;
  const originals = (task.document_baselines || []).map(b => b.original).filter(Boolean);
  const records = [...task.checks, ...(task.document_receipts || []), ...task.events.filter(e => e.previous_closeout).map(e => e.previous_closeout), ...(task.context_closeout ? [task.context_closeout] : [])];
  for (const entry of records.flatMap(r => r.evidence || [])) {
    if (entry.original) originals.push(entry.original);
    else if (fileDigest(root, entry.path) !== entry.digest) return false;
  }
  return originals.every(o => originalIntact(root, o));
}
function closeoutStatus(root, task) {
  const c = task.context_closeout;
  if (!c) return { pass: false, reason: "context_compaction_missing", content_review: "not_run", static_integrity: "not_run", independent_recovery: "not_run" };
  const fresh = (branchMode(root) && task.status === "complete" && task.final_validation ? validChecks(root, task).every(v => v.pass) : c.signature === closeoutSignature(root, task)) && c.evidence.every(e => fileDigest(root, e.path) === e.digest);
  const intact = archiveIntact(root, task);
  const recovered = c.recovery_check.status !== "fail";
  return { pass: fresh && intact && recovered, reason: !fresh ? "context_compaction_stale" : !intact ? "historical_original_missing_or_changed" : !recovered ? "recovery_check_failed" : "current",
    content_review: fresh ? "recorded_by_executor" : "stale", static_integrity: intact ? "pass" : "fail", independent_recovery: c.recovery_check.status };
}
function brief(root, task) {
  const fields = ["id", "title", "request", "executor", "status", "branch", "base_commit", "milestone", "revision", "plan_revision", "sources", "write_scope", "plan", "acceptance", "document_impacts", "document_tasks", "progress", "summary", "next_action"];
  const result = Object.fromEntries(fields.map(k => [k, task[k]]));
  const current = closeoutStatus(root, task);
  // Completed work is recovered from its current synthesis, not its old execution plan.
  if (task.status === "complete") { delete result.plan; delete result.progress; }
  if (task.context_closeout) {
    const { signature, evidence: refs, ...content } = task.context_closeout;
    result.context = { ...content, evidence: refs.map(e => e.path), current: current.pass };
  }
  result.validation_now = validChecks(root, task);
  result.documents_now = documentStatus(root, task);
  result.compaction_now = current;
  if (delivery.policy(root)) {
    try {
      if (task.status === "complete") delivery.validateArchive(root, task.id);
      else delivery.assertReviewed(root, task.id);
      result.delivery_now = { pass: true, status: task.status === "complete" ? (branchMode(root) ? "finalized" : "archived") : "reviewed" };
    } catch (error) { result.delivery_now = { pass: false, reason: error.message }; }
  }
  result.current_checks = task.acceptance.map(a => {
    const check = task.checks.findLast(c => c.criteria.includes(a.id));
    return { id: a.id, method: a.verification, status: check?.status || "not_run", current: result.validation_now.find(v => v.id === a.id).pass, summary: check?.summary || null,
      evidence: (check?.evidence || []).map(e => ({ path: e.path, original: e.original || null })) };
  });
  result.path = `${ROOT}/${task.id}/task.json`;
  result.history = { path: result.path, read_with: "show --history", checks: task.checks.length, owner_receipts: task.document_receipts?.length || 0, events: task.events.length };
  return result;
}
export function compact(project, id, input) {
  return locked(project, ({ root, branch }) => {
    const task = load(root, id, branch); active(task);
    assert(documentStatus(root, task).every(d => d.pass), "Reconcile all canonical documents before context compaction");
    assert(validChecks(root, task).every(c => c.pass), "Current acceptance evidence required before context compaction");
    assert(text(input.outcome) && text(input.rationale) && text(input.verification_scope) && text(input.limitations), "Compaction requires outcome, rationale, verification_scope and limitations");
    assert(Array.isArray(input.decisions) && Array.isArray(input.retained_items) && Array.isArray(input.documents), "Declare decisions, retained_items and document consolidation");
    const refs = [];
    for (const d of input.decisions) {
      assert(text(d.summary) && text(d.source), "Decision requires a summary and source");
      if (d.source !== "task.request") refs.push(d.source);
    }
    for (const item of input.retained_items) {
      assert(/^[A-Z][A-Z0-9_-]*$/.test(item.id) && text(item.summary) && text(item.next_action) && Array.isArray(item.evidence) && item.evidence.length, "Retained item requires stable ID, summary, next action and evidence");
      refs.push(...item.evidence);
    }
    assert(new Set(input.retained_items.map(i => i.id)).size === input.retained_items.length, "Duplicate retained item ID");
    const resolved = input.resolved_items || [];
    assert(Array.isArray(resolved) && new Set(resolved.map(i => i.id)).size === resolved.length, "Invalid resolved item list");
    for (const item of resolved) {
      assert(/^[A-Z][A-Z0-9_-]*$/.test(item.id) && !input.retained_items.some(i => i.id === item.id) && ["resolved", "superseded", "cancelled"].includes(item.disposition) && text(item.summary) && Array.isArray(item.evidence) && item.evidence.length, "Resolved item requires ID, disposition, explanation and evidence");
      refs.push(...item.evidence);
    }
    assert((task.context_closeout?.retained_items || []).every(i => input.retained_items.some(n => n.id === i.id) || resolved.some(n => n.id === i.id)), "Previously retained items need an explicit evidenced disposition before removal");
    assert(input.documents.length === task.document_tasks.length && new Set(input.documents.map(d => d.document)).size === input.documents.length, "Context review must cover every affected document responsibility once");
    for (const d of input.documents) {
      assert(task.document_tasks.some(job => job.id === d.document) && ["consolidated", "already_concise"].includes(d.disposition) && text(d.summary), "Document context review needs a known responsibility, disposition and actual reasoning");
    }
    const recovery = input.recovery_check || { status: "not_run", reason: "No independent fresh-session recovery trial recorded" };
    assert(["pass", "fail", "not_run"].includes(recovery.status), "Invalid recovery check status");
    assert(task.context_closeout?.recovery_check.status !== "fail" || recovery.status !== "not_run", "A failed recovery trial cannot be replaced by NOT_RUN; record the actual corrective rerun");
    if (recovery.status === "not_run") assert(text(recovery.reason), "Explain the unrun recovery check");
    else {
      assert(text(recovery.executor) && recovery.executor !== task.executor && text(recovery.runtime_id) && text(recovery.authorization_source) && text(recovery.summary) && Array.isArray(recovery.evidence) && recovery.evidence.length, "Recovery trial requires actual independent executor, runtime, authority, summary and evidence");
      refs.push(...recovery.evidence);
      if (recovery.authorization_source !== "task.request") refs.push(recovery.authorization_source);
    }
    const content = Object.fromEntries(["outcome", "rationale", "verification_scope", "limitations", "decisions", "retained_items", "documents"].map(k => [k, input[k]]));
    content.resolved_items = resolved;
    content.recovery_check = recovery;
    if (branchMode(root)) {
      // Only the latest effective results belong to the final task record.
      const latest = new Map();
      for (const check of task.checks) for (const criterion of check.criteria) latest.set(criterion, check);
      task.checks = [...new Set(latest.values())];
      task.document_receipts = task.document_tasks.map(d => task.document_receipts.findLast(r => r.document === d.id));
      task.events = [];
      for (const baseline of task.document_baselines) delete baseline.original;
    }
    const signature = closeoutSignature(root, task);
    const proof = refs.length ? evidence(root, [...new Set(refs)], task) : [];
    const next = { ...content, executor: task.executor, signature, evidence: proof };
    // Repeating the same cleanup must not manufacture snapshots, events or timestamps.
    if (JSON.stringify(task.context_closeout) === JSON.stringify(next)) {
      assert(archiveIntact(root, task), "Historical originals missing or changed");
      return task;
    }
    if (task.context_closeout && !branchMode(root)) task.events.push({ at: now(), action: "compact-replaced", previous_closeout: task.context_closeout });
    task.context_closeout = next;
    assert(archiveIntact(root, task), "Historical originals missing or changed");
    return save(root, task);
  });
}
export function list(project) {
  const { root } = context(project);
  const dir = pathAt(root, ROOT);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(id => /^Q[0-9]{3,}-/.test(id)).filter(id => existsSync(taskPath(root, id)) || !existsSync(pathAt(root, `${ROOT}/${id}/branch.json`))).sort().map(id => {
    const t = json(taskPath(root, id));
    return { id, title: t.title, status: t.status, branch: t.branch, milestone: t.milestone, next_action: t.next_action, path: `${ROOT}/${id}/task.json` };
  });
}
export function show(project, id, { history = false } = {}) {
  const { root } = context(project);
  const stored = json(taskPath(root, id));
  if (stored.completion_kind === "historical_completion_preserved") {
    const { summary } = delivery.validateSummary(root, id);
    assert(summary.closed && summary.facts?.historical && summary.facts?.kind === "quick", "Historical Quick needs its closed completion summary");
    return { ...stored, summary: summary.outcome, verification: { summary: summary.verification, reexecuted: false, kind: "historical_completion_preserved" },
      validation_now: [], current_checks: [], documents_now: [{ pass: true, scope: "retained_document_integrity" }],
      compaction_now: { pass: true, reason: "historical_content_consolidated", independent_recovery: "not_run" },
      delivery_now: { pass: true, status: "closed" }, path: `${ROOT}/${id}/task.json` };
  }
  const task = load(root, id);
  return history ? { ...task, validation_now: validChecks(root, task), documents_now: documentStatus(root, task), compaction_now: closeoutStatus(root, task), path: `${ROOT}/${id}/task.json` } : brief(root, task);
}
export function dispatch(project, id, document) {
  const { root } = context(project), task = load(root, id);
  const job = task.document_tasks.find(d => d.id === document);
  assert(job, "Unknown document task");
  const definition = job.role.startsWith("product/") ? `roles/product/variants/${job.role.split("/")[1]}.md` : job.role === "gatekeeper" ? "roles/gatekeeper/ROLE.md" : `roles/${job.role}.md`;
  return { task: id, document, role: job.role, role_definition: definition, mode: "task-scoped responsibility; packet only, no agent launched", request: task.request, change: job.change, sources: task.sources, write_scope: job.paths, baselines: task.document_baselines.filter(b => job.paths.includes(b.path)), dependencies: documentStatus(root, task).filter(d => job.depends_on.includes(d.id)), approval_required: job.approval_required, approval_source: job.approval_source, return_contract: (branchMode(root) ? "Consolidate effective current documents, remove resolved development records, preserve unresolved scope and final evidence; closed milestones are read-only. Report actual responsibility result through reconcile." : "Update and consolidate canonical documents: retain current constraints, reasons, effective results, limitations, retained IDs and evidence routes; remove repeated rounds and obsolete actions from default reading. Preserve original versions; report actual executor/mode, decision source, downstream impact and evidence through reconcile. Do not alter milestone state or frozen approvals.") };
}
// Task-scoped authority shared by CLI and native model dispatch; no milestone activation.
export function modelTaskContext(project, id, role, packet) {
  const { root, branch } = context(project, true), task = load(root, id, branch);
  active(task);
  assert(Object.values(documentRoles).flat().includes(role), "Unknown Quick responsibility role");
  assert(packet.write_scope.every(path => task.write_scope.includes(path)), "Model task write_scope exceeds the active Quick task");
  for (const path of packet.write_scope) pathAt(root, path);
  const role_definition = role.startsWith("product/") ? `roles/product/variants/${role.split("/")[1]}.md` : role === "gatekeeper" ? "roles/gatekeeper/ROLE.md" : `roles/${role}.md`;
  return { mode: "quick", id, role, role_definition, plan_revision: task.plan_revision };
}
export function reconcile(project, id, receipt) {
  return locked(project, ({ root, branch }) => {
    const task = load(root, id, branch); active(task);
    const job = task.document_tasks.find(d => d.id === receipt.document);
    assert(receipt.status === "pass", "Only an explicitly completed owner result can reconcile; record blocked/failed work with checkpoint or block");
    assert(job && text(receipt.executor) && text(receipt.summary) && ["serial", "delegated"].includes(receipt.mode), "Document receipt requires task, actual executor, mode and summary");
    if (receipt.mode === "serial") assert(receipt.executor === task.executor, "Serial responsibility must name the actual task executor");
    else {
      assert(text(receipt.runtime_id) && text(receipt.authorization_source) && (receipt.authorization_source === "task.request" || fileDigest(root, receipt.authorization_source) !== null), "Delegated receipt requires actual runtime ID and authorization source");
      const role = job.role.split("/")[0], prefix = { uiux: "designer", quality: "qa", "backend-architect": "backend", "frontend-architect": "frontend", "backend-implementer": "backend", "frontend-implementer": "frontend" }[role] || role;
      assert(new RegExp(`^${prefix}-[a-z]{2,16}$`).test(receipt.executor), "Delegated executor needs the responsibility role's semantic name");
    }
    const status = documentStatus(root, task);
    assert(job.depends_on.every(dep => status.find(s => s.id === dep).pass), "Upstream document owner has not reconciled the current version");
    assert(!job.approval_required || approvalDigest(root, task, job) !== null, "Required decision/approval source is missing");
    assert(job.paths.every(p => task.document_baselines.some(b => b.path === p && b.digest !== fileDigest(root, p)) && fileDigest(root, p) !== null), "Canonical documents must be updated; a Quick summary is not writeback");
    const saved = { at: now(), document: job.id, role: job.role, status: "pass", executor: receipt.executor, mode: receipt.mode, runtime_id: receipt.runtime_id || null, authorization_source: receipt.authorization_source || null, independent_review: false, summary: receipt.summary, signature: documentSignature(root, task, job), evidence: evidence(root, [...new Set([...job.paths, ...(receipt.evidence || [])])], task) };
    task.document_receipts.push(saved);
    return save(root, task);
  });
}
export function create(project, spec) {
  const { root } = context(project);
  if (branchMode(root)) {
    specCheck(root, spec);
    assert(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(spec.slug) && spec.slug.length <= 60, "Invalid task slug");
    const number = 1 + Math.max(0, ...list(root).map(t => Number(t.id.match(/^Q([0-9]+)-/)[1])));
    const id = `Q${String(number).padStart(3, "0")}-${spec.slug}`;
    const branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
    if (branch === (delivery.policy(root).main_branch || "main")) {
      assert(!git(root, ["status", "--porcelain"]), "Start a Quick from clean main; preserve existing edits first");
      delivery.assertWritable(root, spec.write_scope);
      git(root, ["switch", "-c", `quick/${id}`]);
    }
  }
  return locked(project, ({ root, branch }) => {
    specCheck(root, spec);
    assert(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(spec.slug) && spec.slug.length <= 60, "Invalid task slug");
    const all = list(root);
    assert(!all.some(t => t.id.endsWith(`-${spec.slug}`) && !terminal.has(t.status)), "An unfinished task with this slug exists; resume it");
    const number = 1 + Math.max(0, ...all.map(t => Number(t.id.match(/^Q([0-9]+)-/)[1])));
    const id = `Q${String(number).padStart(3, "0")}-${spec.slug}`;
    if (branchMode(root)) {
      assert(branch === `quick/${id}`, `Create this task on quick/${id}`);
      delivery.assertWritable(root, [...spec.write_scope, `${ROOT}/${id}/task.json`]);
    }
    const task = Object.fromEntries(definitionKeys.map(k => [k, spec[k]]));
    Object.assign(task, { schema_version: 1, id, status: "planned", revision: 1, plan_revision: 1, branch, base_commit: git(root, ["rev-parse", "HEAD"]), initial_scope_status: git(root, ["status", "--porcelain", "--", ...spec.write_scope]), created_at: now(), updated_at: now(), checks: [], document_receipts: [], events: [], progress: null, summary: null, next_action: "Start the approved bounded task" });
    const file = taskPath(root, id);
    mkdirSync(dirname(file), { recursive: true });
    captureDocumentBaselines(root, task);
    writeFileSync(file, JSON.stringify(task, null, 2) + "\n", { flag: "wx" });
    return task;
  });
}
export function change(project, id, action, { reason, target, summary, next, spec } = {}) {
  return locked(project, ({ root, branch }) => {
    const task = load(root, id, branch);
    assert(!terminal.has(task.status), "Terminal task is immutable; create a follow-up task");
    let previousPlan;
    if (action === "start") {
      assert(["planned", "blocked"].includes(task.status), "Task is already active");
      if (task.status === "blocked") assert(text(reason), "Explain how the blocker was resolved");
      task.status = "active"; task.next_action = "Execute the scoped plan and verify acceptance";
    } else if (action === "revise") {
      specCheck(root, spec);
      if (branchMode(root)) delivery.assertWritable(root, spec.write_scope);
      assert(text(reason), "Plan revision requires a reason");
      previousPlan = Object.fromEntries(["plan_revision", "write_scope", "sources", "plan", "acceptance", "progress", "document_impacts", "document_tasks"].map(k => [k, task[k]]));
      for (const key of definitionKeys.filter(k => k !== "request")) task[key] = spec[key];
      captureDocumentBaselines(root, task);
      task.plan_revision += 1; task.status = "planned"; task.progress = null; task.next_action = "Start the revised plan; prior validation is historical";
    } else if (action === "checkpoint") {
      active(task);
      assert(text(summary) && text(next), "Checkpoint requires progress summary and next action");
      task.progress = summary; task.next_action = next;
    } else if (action === "finish") {
      active(task);
      const documents = documentStatus(root, task);
      assert(documents.every(d => d.pass), `Document reconciliation incomplete or stale: ${documents.filter(d => !d.pass).map(d => d.id).join(", ")}`);
      const checks = validChecks(root, task);
      assert(checks.every(x => x.pass), `Unverified, failed or stale acceptance: ${checks.filter(x => !x.pass).map(x => x.id).join(", ")}`);
      const closeout = closeoutStatus(root, task);
      assert(closeout.pass, `Context compaction required: ${closeout.reason}`);
      if (branchMode(root) && existsSync(pathAt(root, ".planning/agt/workstreams.json"))) {
        assert(streams.list(root).every(child => child.integrated && !child.dirty && !child.session), "Integrate and release every child workstream before Quick completion");
      }
      if (delivery.policy(root)) delivery.assertReviewed(root, task.id);
      if (branchMode(root)) task.final_validation = { documents, checks: checks.map(c => ({ ...c, evidence: task.checks.findLast(x => x.criteria.includes(c.id)).evidence })) };
      assert(summary === undefined || summary === task.context_closeout.outcome, "Finish summary must match the reviewed context outcome; revise compact input first");
      task.status = "complete"; task.summary = task.context_closeout.outcome; task.next_action = null;
      task.completed_fingerprint = fingerprint(root, task);
    } else {
      assert(["block", "escalate", "cancel"].includes(action) && text(reason), "Action requires a reason");
      if (action === "escalate") assert(text(target), "Escalation target required");
      task.status = { block: "blocked", escalate: "escalated", cancel: "cancelled" }[action];
      task.next_action = action === "cancel" ? null : target || reason;
    }
    if (action !== "checkpoint") task.events.push({ at: now(), action, reason: reason || null, target: target || null, ...(previousPlan ? { previous_plan: previousPlan } : {}) });
    return save(root, task, action === "finish" && delivery.policy(root) ? () => {
      const records = [...task.checks, ...task.document_receipts, ...task.events.filter(e => e.previous_closeout).map(e => e.previous_closeout), task.context_closeout];
      const originals = [...task.document_baselines.map(b => b.original), ...records.flatMap(r => (r.evidence || []).map(e => e.original))].filter(Boolean);
      const required = branchMode(root)
        ? [...new Set([...task.checks, task.context_closeout].flatMap(r => r.evidence || []).map(e => e.path).filter(p => p.startsWith(`${ROOT}/${id}/`)))]
        : [...new Set(originals.map(o => o.snapshot).filter(Boolean))];
      delivery.seal(root, task.id, { kind: "quick", status: "complete", outcome: task.summary, verified_fingerprint: task.completed_fingerprint },
        { required, overrides: { [`${ROOT}/${task.id}/task.json`]: JSON.stringify(task, null, 2) + "\n" } });
    } : undefined);
  });
}
export function observe(project, id, observations) {
  return locked(project, ({ root, branch }) => {
    const task = load(root, id, branch); active(task);
    requireUpstreamDocuments(root, task);
    assert(Array.isArray(observations) && observations.length, "Observations required");
    const additions = observations.map(o => {
      criteria(task, o.criteria, o.method);
      assert(["inspection", "manual"].includes(o.method) && ["pass", "fail", "not_run"].includes(o.status) && text(o.summary), "Invalid observation");
      return { at: now(), criteria: o.criteria, method: o.method, status: o.status, summary: o.summary, observer: task.executor, fingerprint: fingerprint(root, task), evidence: evidence(root, o.evidence, task) };
    });
    task.checks.push(...additions);
    return save(root, task);
  });
}
export function verify(project, id, commands) {
  return locked(project, ({ root, branch }) => {
    const task = load(root, id, branch); active(task);
    requireUpstreamDocuments(root, task);
    assert(Array.isArray(commands) && commands.length, "Check commands required");
    // Validate the entire request before executing any command.
    for (const c of commands) {
      criteria(task, c.criteria, "command");
      assert(Array.isArray(c.argv) && c.argv.length && c.argv.every(text) && !c.argv.some(s => s.includes("\0")), "Check requires argv strings");
      assert(c.timeout_ms === undefined || (Number.isInteger(c.timeout_ms) && c.timeout_ms > 0 && c.timeout_ms <= 300000), "Invalid check timeout");
    }
    const before = fingerprint(root, task);
    const results = commands.map(c => {
      const r = spawnSync(c.argv[0], c.argv.slice(1), { cwd: root, encoding: "utf8", timeout: c.timeout_ms ?? 120000, maxBuffer: 2 * 1024 * 1024, shell: false });
      return { criteria: c.criteria, argv: c.argv, exit_code: r.status, signal: r.signal, error: r.error?.message || null, stdout: r.stdout || "", stderr: r.stderr || "" };
    });
    const after = fingerprint(root, task);
    let n = 1;
    while (existsSync(pathAt(root, `${ROOT}/${id}/check-${n}.json`))) n += 1;
    const logPath = `${ROOT}/${id}/check-${n}.json`;
    writeFileSync(pathAt(root, logPath), JSON.stringify({ before, after, results }, null, 2) + "\n", { flag: "wx" });
    for (const criterion of new Set(results.flatMap(r => r.criteria))) {
      const relevant = results.filter(r => r.criteria.includes(criterion));
      task.checks.push({ at: now(), criteria: [criterion], method: "command", commands: relevant.map(r => ({ argv: r.argv, exit_code: r.exit_code })), status: relevant.every(r => r.exit_code === 0 && !r.error) && before === after ? "pass" : "fail", summary: before === after ? "Process result; semantic coverage reviewed by executor" : "Scope or source content changed during checks; rerun on stable inputs", fingerprint: after, evidence: evidence(root, [logPath], task) });
    }
    save(root, task);
    assert(results.every(r => r.exit_code === 0 && !r.error) && before === after, "Checks failed or inputs changed; failure evidence saved");
    return task;
  });
}
