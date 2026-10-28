import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

export const CONFIG = ".planning/agt/workstreams.json";
export const LOCAL_CONFIG = ".agt/workstreams.json";
export const assert = (condition, message) => { if (!condition) throw Error(message); };
export function git(cwd, args, optional = false) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    if (optional) return null;
    throw Error(`git ${args[0]}: ${r.stderr || r.stdout || r.error?.message || "failed"}`);
  }
  return r.stdout.trimEnd();
}
export function yaml(text) {
  const r = spawnSync("ruby", ["-e", 'require "yaml"; require "json"; require "date"; puts JSON.generate(YAML.safe_load(STDIN.read, permitted_classes: [Time,Date], aliases: false))'], {
    input: text, encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024,
  });
  assert(r.status === 0, `Cannot read YAML with Ruby: ${r.stderr || r.error?.message}`);
  return JSON.parse(r.stdout);
}
export const readYaml = path => yaml(readFileSync(path, "utf8"));
export const readJson = path => JSON.parse(readFileSync(path, "utf8"));
export function safePath(path) {
  assert(typeof path === "string" && path.length && !isAbsolute(path) && !/[\\\0\r\n]/.test(path) && !path.split("/").some(p => ["..", ".", ""].includes(p)), `Unsafe relative path: ${path}`);
  return path;
}
export function inside(root, path) {
  safePath(path);
  let current = realpathSync(root);
  for (const part of path.split("/")) {
    current = resolve(current, part);
    assert(!lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink(), `Symlink is not allowed in managed path: ${path}`);
  }
  return current;
}
export function parentId(config) { return config.parent?.id || config.milestone; }
export function streamRoot(milestone, id) {
  assert(/^(?:M[0-9]{3}|Q[0-9]{3,}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.test(milestone), "Parent must be a milestone or Quick ID");
  assert(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id), "Workstream ID must use lowercase kebab-case");
  return `.planning/${milestone.startsWith("Q") ? "quick" : "milestones"}/${milestone}/workstreams/${id}`;
}
export function validateConfig(config) {
  assert([1, 2].includes(config?.schema_version) && config.mode === "workstreams", "Invalid workstream configuration");
  assert([undefined, "local", "branch"].includes(config.planning_storage), "Unsupported planning storage");
  assert(config.profile?.workflow?.workstreams?.supported === true && config.profile.workflow.workstreams.opt_in === true, "Locked Profile does not support opt-in workstreams");
  assert(config.profile.workflow.workstreams.artifact_root === ".planning/milestones/{milestone}/workstreams/{workstream}", "Unsupported artifact root");
  assert(typeof config.target === "string" && config.target && !config.target.startsWith("-"), "Missing integration target");
  assert(Array.isArray(config.profile.roles) && config.profile.roles.length && Array.isArray(config.profile.workflow.stages) && config.profile.workflow.stages.length, "Invalid Profile roles/stages");
  for (const stage of config.profile.workflow.stages) {
    assert(Array.isArray(stage.allowed_roles) && Array.isArray(stage.transitions) && Array.isArray(stage.required_artifacts), "Invalid Profile stage");
    for (const path of stage.required_artifacts) assert(safePath(path).startsWith(".planning/milestones/{milestone}/"), "Workstream artifacts must be milestone-relative");
  }
  if (config.schema_version === 2) {
    const p = config.parent;
    assert(config.planning_storage === "branch" && p && ["milestone", "quick"].includes(p.kind), "Branch workstreams require a scoped parent");
    assert(p.branch === config.target && typeof p.base_commit === "string" && /^[a-f0-9]{40,64}$/.test(p.base_commit), "Parent target/base mismatch");
    assert(p.kind === "milestone" ? /^M[0-9]{3}$/.test(p.id) : /^Q[0-9]{3,}-/.test(p.id), "Parent kind/ID mismatch");
    assert(config.target === (p.kind === "milestone" ? `milestone/${p.id}` : `quick/${p.id}`), "Workstream target must be its parent branch");
    const inherited = config.inherited_workstreams || [];
    assert(Array.isArray(inherited) && new Set(inherited.map(item => item.id)).size === inherited.length, "Inherited workstreams must have unique IDs");
    for (const item of inherited) {
      streamRoot(p.id, item.id);
      assert(/^[a-f0-9]{40,64}$/.test(item.source_commit) && /^[a-f0-9]{40,64}$/.test(item.integration_commit), "Inherited workstreams need full source/integration commits");
    }
  }
  streamRoot(parentId(config), "check");
  return config;
}
// Historical integration is a frozen adoption fact, not an active legacy binding.
export function inheritedWorkstreamStatus(root, config, item, target = config.target) {
  const branch = `agt/${parentId(config)}/${item.id}`;
  const observed = git(root, ["rev-parse", "--verify", `refs/heads/${branch}`], true);
  const ancestor = (a, b) => git(root, ["merge-base", "--is-ancestor", a, b], true) !== null;
  const error = observed && observed !== item.source_commit ? "inherited_source_changed"
    : !ancestor(item.source_commit, item.integration_commit) || !ancestor(item.integration_commit, target) ? "inherited_integration_not_in_parent" : null;
  return { branch, observed_source: observed, integrated: error === null, error };
}
export function artifacts(profile, parent, id, stage) {
  const root = id ? streamRoot(parent, id) : `.planning/${parent.startsWith("Q") ? "quick" : "milestones"}/${parent}`;
  const selected = stage === "final" ? { required_artifacts: profile.workflow.final_artifacts || [] } : profile.workflow.stages.find(s => s.id === stage);
  assert(selected, `Unknown stage: ${stage}`);
  return selected.required_artifacts.map(p => {
    const prefix = ".planning/milestones/{milestone}/";
    assert(p.startsWith(prefix), `Artifact outside milestone: ${p}`);
    return safePath(`${root}/${p.slice(prefix.length)}`);
  });
}
export function worktrees(project) {
  return git(project, ["worktree", "list", "--porcelain", "-z"]).split("\0\0").filter(Boolean).map(block => {
    const fields = Object.fromEntries(block.split("\0").filter(Boolean).map(line => {
      const n = line.indexOf(" ");
      return n < 0 ? [line, true] : [line.slice(0, n), line.slice(n + 1)];
    }));
    return { path: fields.worktree, branch: fields.branch?.replace(/^refs\/heads\//, ""), head: fields.HEAD };
  });
}

// Read-only and usable by every caller, including the optional model launcher.
export function resolveContext(project) {
  const root = git(project, ["rev-parse", "--show-toplevel"], true) || resolve(project);
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true);
  assert(!(existsSync(inside(root, CONFIG)) && existsSync(inside(root, LOCAL_CONFIG))), "Conflicting legacy/local workstream configurations");
  const configPath = inside(root, existsSync(inside(root, LOCAL_CONFIG)) ? LOCAL_CONFIG : CONFIG);
  if (!existsSync(configPath)) {
    assert(!branch?.startsWith("agt/"), "Workstream configuration missing; refusing project-state fallback");
    return { mode: "single", project: root, state: ".planning/workflow/state.yaml", agents: ".planning/agt/agents.yaml", history: ".planning/workflow/history.yaml" };
  }
  const config = validateConfig(readJson(configPath));
  assert(config.planning_storage !== "local" || existsSync(inside(root, ".agt/delivery.json")), "Local workstreams require delivery policy");
  const parent = parentId(config), prefix = `agt/${parent}/`;
  if (branch === config.target) return { mode: "coordinator", project: root, config, state: ".planning/workflow/state.yaml", agents: ".planning/agt/agents.yaml", history: ".planning/workflow/history.yaml" };
  assert(branch?.startsWith(prefix), "No workstream binding for current branch (or detached HEAD); choose its worktree explicitly");
  const id = branch.slice(prefix.length), artifactRoot = streamRoot(parent, id);
  assert(!config.inherited_workstreams?.some(item => item.id === id), "Inherited workstream is retired and read-only; start a new child for further work");
  const metadata = readJson(inside(root, `${artifactRoot}/workstream.json`));
  assert(metadata.branch === branch && metadata.id === id && metadata.milestone === config.milestone && (config.schema_version !== 2 || metadata.parent?.id === parent) && metadata.target === config.target, "Workstream binding mismatch");
  const state = `${artifactRoot}/workflow/state.yaml`;
  const value = readYaml(inside(root, state));
  assert(value.workstream === id && value.milestone === config.milestone && value.profile === `${config.profile.id}@${config.profile.version}`, "Workstream state scope mismatch");
  return { mode: "workstream", project: root, config, id, metadata, artifact_root: artifactRoot, state, agents: `${artifactRoot}/workflow/agents.yaml`, history: `${artifactRoot}/workflow/history.yaml`, required_artifacts: artifacts(config.profile, parent, id, value.stage) };
}
