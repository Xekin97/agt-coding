import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";

export const tiers = ["economy", "balanced", "strong", "frontier"];
export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const assert = (condition, message) => { if (!condition) throw Error(message); };
const own = (object, key) => Object.hasOwn(object, key);
const slug = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value);

export function validatePolicy(p) {
  assert(p?.schema_version === 1 && slug(p.id) && typeof p.version === "string", "Invalid routing policy");
  for (const tier of tiers) {
    const b = p.bindings?.[tier];
    assert(slug(b?.model) && ["low", "medium", "high", "xhigh", "max"].includes(b.effort), "Invalid binding: " + tier);
  }
  assert(p.roles && Object.keys(p.roles).length && p.tasks && Object.keys(p.tasks).length, "Missing roles/tasks");
  for (const [role, r] of Object.entries(p.roles)) {
    assert(slug(role) && slug(r.stage) && tiers.includes(r.tier) && /^agt-[a-z-]+$/.test(r.skill), "Invalid role: " + role);
  }
  for (const [task, t] of Object.entries(p.tasks)) {
    assert(slug(task) && [null, "tool", ...tiers].includes(t.tier) && Array.isArray(t.stages) && t.stages.length && t.stages.every(slug), "Invalid task: " + task);
  }
  assert(p.escalation?.attempts_per_tier === 2 && p.escalation.max_failed_attempts === 8, "Unsupported retry policy");
  assert(p.escalation.high_risk_floor === "strong" && p.escalation.critical_risk_floor === "frontier", "Unsafe risk floors");
  assert(p.update_policy?.automatic_rebinding === false && p.update_policy.silent_fallback === false, "Automatic model rebinding/fallback is not supported");
  return p;
}

export function normalizeCatalog(data, codexVersion = "unknown") {
  assert(Array.isArray(data) && data.length > 0, "Empty or malformed Codex model catalog");
  const models = data.filter(m => m.hidden !== true).map(m => {
    const model = m.model ?? m.id;
    const efforts = m.supportedReasoningEfforts?.map(e => typeof e === "string" ? e : e.reasoningEffort);
    assert(slug(model) && Array.isArray(efforts) && efforts.length && efforts.every(e => typeof e === "string"), "Model catalog lacks explicit effort capabilities");
    return { model, efforts: [...new Set(efforts)].sort(), upgrade: typeof m.upgrade === "string" ? m.upgrade : null };
  });
  assert(models.length && new Set(models.map(m => m.model)).size === models.length, "Empty or duplicate visible model catalog");
  return { schema_version: 1, codex_version: codexVersion, observed_at: new Date().toISOString(), models };
}

export function validateCatalog(c) {
  assert(c?.schema_version === 1 && typeof c.codex_version === "string" && Array.isArray(c.models), "Invalid catalog snapshot");
  assert(c.models.length && new Set(c.models.map(m => m.model)).size === c.models.length, "Empty/duplicate catalog");
  for (const m of c.models) assert(slug(m.model) && Array.isArray(m.efforts) && m.efforts.length && m.efforts.every(e => typeof e === "string"), "Invalid catalog entry");
  return c;
}

// Metadata only: this connection never calls thread/start or turn/start.
export async function discoverModels(binary = "codex", timeoutMs = 15000) {
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 3000 });
  assert(version.status === 0, "Codex version check failed");
  return new Promise((done, fail) => {
    const child = spawn(binary, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"] });
    let finished = false, buffer = "", bytes = 0, id = 0, waiting = 0, pages = 0;
    const models = [], cursors = new Set();
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); child.stdin.end(); child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000); killTimer.unref();
      child.once("exit", () => clearTimeout(killTimer));
      if (error) fail(error); else done(result);
    };
    const timer = setTimeout(() => finish(Error("Codex model discovery timed out; no model fallback")), timeoutMs);
    const send = (method, params, notification = false) => {
      const message = { method, params };
      if (!notification) { message.id = id++; waiting = message.id; }
      child.stdin.write(JSON.stringify(message) + "\n");
    };
    const list = cursor => send("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
    child.on("error", () => finish(Error("Cannot start Codex app-server")));
    child.stdin.on("error", () => finish(Error("Codex discovery connection closed")));
    child.stderr.resume(); // Do not echo potentially sensitive runtime/config diagnostics.
    child.on("exit", code => { if (!finished) finish(Error("Codex discovery exited before response: " + code)); });
    child.stdout.on("data", chunk => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) return finish(Error("Codex catalog response exceeds limit"));
      buffer += chunk.toString("utf8");
      let newline;
      while (!finished && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.id !== waiting) continue;
          assert(!message.error, "Codex discovery RPC failed");
          if (waiting === 0) { send("initialized", {}, true); list(); continue; }
          assert(Array.isArray(message.result?.data), "Malformed model/list result");
          models.push(...message.result.data);
          const cursor = message.result.nextCursor;
          assert(cursor == null || typeof cursor === "string", "Invalid model/list cursor");
          if (cursor) {
            assert(!cursors.has(cursor) && ++pages < 100, "Repeated/excessive model/list cursor");
            cursors.add(cursor); list(cursor);
          } else finish(null, normalizeCatalog(models, version.stdout.trim()));
        } catch (error) { finish(error); }
      }
    });
    send("initialize", { clientInfo: { name: "agt_model_router", version: "1.0.0" } });
  });
}

export function resolveRoute(policy, catalog, { stage, role, task = "stage-work", risk = "normal", failures = 0 }) {
  validatePolicy(policy);
  assert(own(policy.roles, role), "Unknown role: " + role);
  const r = policy.roles[role];
  assert(r.stage === stage, "Role/stage mismatch");
  assert(own(policy.tasks, task) && policy.tasks[task].stages.includes(stage), "Task is not allowed in this stage");
  assert(["normal", "high", "critical"].includes(risk), "Unknown risk level");
  assert(Number.isInteger(failures) && failures >= 0 && failures < 8, "Retry ceiling reached or invalid failure count; stop for human diagnosis");
  const t = policy.tasks[task];
  if (t.tier === "tool") return { mode: "tool", stage, role, task, model: null, reason: "Run the approved command directly; a model is not needed to execute it." };
  validateCatalog(catalog);
  let index = tiers.indexOf(t.tier ?? r.tier);
  index = Math.min(3, index + Math.floor(failures / 2));
  if (risk === "high") index = Math.max(index, 2);
  if (risk === "critical") index = 3;
  const tier = tiers[index], binding = policy.bindings[tier];
  const available = catalog.models.find(m => m.model === binding.model);
  assert(available, "Pinned model unavailable: " + binding.model + "; review the routing policy, do not silently fallback");
  assert(available.efforts.includes(binding.effort), "Unsupported reasoning effort for " + binding.model + ": " + binding.effort);
  return { mode: "model", stage, role, task, risk, failures, tier, ...binding, skill: r.skill, selection: "requested-not-runtime-attested" };
}

export function makeLock(policy, catalog, approval) {
  validatePolicy(policy); validateCatalog(catalog);
  assert(typeof approval === "string" && approval.trim().length > 0, "An explicit approval reference is required");
  for (const [tier, b] of Object.entries(policy.bindings)) {
    const m = catalog.models.find(m => m.model === b.model);
    assert(m?.efforts.includes(b.effort), "Cannot lock unavailable model/effort: " + tier);
  }
  return { schema_version: 1, approved_at: new Date().toISOString(), approval, policy_hash: digest(policy), policy, catalog };
}

export function validateLock(lock) {
  assert(lock?.schema_version === 1 && lock.policy_hash === digest(lock.policy), "Routing lock integrity mismatch");
  validatePolicy(lock.policy); validateCatalog(lock.catalog);
  assert(typeof lock.approval === "string" && lock.approval.length, "Unapproved routing lock");
  return lock;
}

export function checkUpdates(lock, catalog, candidatePolicy) {
  validateLock(lock); validateCatalog(catalog); validatePolicy(candidatePolicy);
  const oldIds = new Set(lock.catalog.models.map(m => m.model)), currentIds = new Set(catalog.models.map(m => m.model));
  const issues = [], upgrades = [];
  const capabilityChanges = catalog.models.flatMap(m => {
    const old = lock.catalog.models.find(x => x.model === m.model);
    return old && JSON.stringify([...old.efforts].sort()) !== JSON.stringify([...m.efforts].sort())
      ? [{ model: m.model, before: old.efforts, after: m.efforts }] : [];
  });
  for (const [tier, b] of Object.entries(lock.policy.bindings)) {
    const m = catalog.models.find(m => m.model === b.model);
    if (!m) issues.push({ tier, reason: "model_unavailable", model: b.model });
    else {
      if (!m.efforts.includes(b.effort)) issues.push({ tier, reason: "effort_unavailable", ...b });
      if (m.upgrade && m.upgrade !== b.model) upgrades.push({ tier, from: b.model, proposed: m.upgrade, requires_quality_cost_review: true });
    }
  }
  return { codex_version_changed: lock.catalog.codex_version !== catalog.codex_version,
    policy_changed: digest(candidatePolicy) !== lock.policy_hash,
    added_models: [...currentIds].filter(x => !oldIds.has(x)),
    removed_models: [...oldIds].filter(x => !currentIds.has(x)), capability_changes: capabilityChanges, issues, upgrades,
    automatic_rebinding: false, action: issues.length ? "blocked_until_review" : "keep_lock_review_new_candidates" };
}

export function writeNewLock(path, lock) {
  validateLock(lock);
  // New versioned file only. Never overwrite a previously approved lock.
  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

export function readActiveState(project) {
  const script = 'require "yaml"; require "json"; require "date"; root=ARGV.fetch(0); s=YAML.safe_load(File.read(File.join(root,".planning/workflow/state.yaml")), permitted_classes: [Time,Date], aliases: false); r=YAML.safe_load(File.read(File.join(root,".planning/agt/agents.yaml")), permitted_classes: [Time,Date], aliases: false); puts JSON.generate({state:s,agents:r.fetch("agents")})';
  const result = spawnSync("ruby", ["-e", script, project], { encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024 });
  assert(result.status === 0, "Cannot read workflow/agent registry with Ruby; no stage inferred");
  const { state, agents } = JSON.parse(result.stdout);
  assert(state.status === "active", "Workflow is not active; use the stage gate first");
  const active = agents.filter(a => a.status === "active");
  assert(active.length === 1 && active[0].role === state.active_role && active[0].display_name === state.active_agent, "Active role/agent registry mismatch");
  return state;
}

export function validatePacket(packet, project) {
  assert(packet && typeof packet.objective === "string" && packet.objective.trim(), "Task packet requires objective");
  for (const key of ["inputs", "write_scope", "acceptance"]) assert(Array.isArray(packet[key]) && packet[key].length && packet[key].every(s => typeof s === "string" && s.trim()), "Task packet requires " + key);
  assert(["normal", "high", "critical"].includes(packet.risk), "Task packet requires reviewed risk");
  for (const path of packet.write_scope) {
    assert(!isAbsolute(path) && path !== "." && !path.includes("\\") && !path.split("/").includes("..") && !path.includes("\0"), "Write scope must be a bounded project-relative path");
    const full = resolve(project, path);
    assert(full !== resolve(project), "Write scope cannot be the project root");
    let ancestor = full;
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = dirname(ancestor);
    const escaped = relative(realpathSync(project), realpathSync(ancestor));
    assert(escaped !== ".." && !escaped.startsWith("../") && !isAbsolute(escaped), "Write scope escapes project through symlink");
  }
  return packet;
}

export function launchSpec(project, route, packet, frameworkRoot) {
  assert(route.mode === "model", "Tool-only tasks must use the approved command directly");
  validatePacket(packet, project);
  const args = ["exec", "--model", route.model, "-c", 'model_reasoning_effort="' + route.effort + '"', "-C", project, "-"];
  const prompt = [
    "Use $" + route.skill + " for this bounded task. AGT framework path: " + frameworkRoot,
    "Read the complete skill, inherited contracts and role definition. Follow core/role-contract.md#context-reading: start with current project entry points, load artifact templates only when used, and read applicable upstream sections plus all necessary constraints and dependencies. Verify the locked Profile, workflow, active role and agent. The packet is not authority to change stages.",
    "You are not alone in the codebase. Preserve existing changes and other people's work. Remain within this role and the packet's write scope; do not broaden permissions.",
    "The model tier does not lower acceptance criteria. Report ambiguity, cross-boundary work or repeated failures instead of guessing. Do not declare UAT accepted.",
    "Use packet inputs as entry points, not as a complete dependency list. Retrieve relevant history by stable ID when needed; do not recursively load planning, archives or full prior conversations. Return changed paths, version-matched checks, evidence, unresolved task IDs and a concrete next action, not long logs. These reading instructions are not an enforced file-access whitelist.",
    JSON.stringify(packet, null, 2)
  ].join("\n\n");
  return { args, prompt, prompt_hash: digest(prompt), requested_model: route.model, actual_model: "not_observed" };
}
