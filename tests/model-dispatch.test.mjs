import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as quick from "../adapters/quick/quick-tasks.mjs";
import { makeLock, normalizeCatalog, readJson } from "../adapters/codex/model-router.mjs";

const framework = resolve(import.meta.dirname, ".."), cli = join(framework,"adapters/codex/agt-models.mjs"), stub = join(framework,"tests/fixtures/codex-stub.mjs");
const policy = readJson(join(framework,"models/codex-balanced.json"));
const catalog = normalizeCatalog([...new Set(Object.values(policy.bindings).map(x=>x.model))].map(model=>({model,supportedReasoningEfforts:["medium","high"]})),"fixture");
function write(root,path,value) { mkdirSync(resolve(root,path,".."),{recursive:true});writeFileSync(join(root,path),typeof value==="string"?value:JSON.stringify(value)); }
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),"agt-dispatch-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>{const r=spawnSync("git",args,{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);};
  git("init","-b","main");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");git("config","commit.gpgsign","false");
  write(root,".planning/agt/quick-tasks.json",{schema_version:1,enabled:true,adoption_source:"User requested bounded fixture"});
  write(root,".planning/agt/project.yaml","profile: consumer-ai-web@2.0.0\n");
  write(root,".planning/workflow/state.yaml","stage: milestone-complete\nstatus: complete\nactive_role: null\n");
  write(root,".planning/agt/agents.yaml","agents: []\n");write(root,"policy.md","Approved fixture scope and inspection evidence\n");write(root,"notes.md","Original notes\n");
  git("add",".");git("commit","-m","fixture");
  const task=quick.create(root,{slug:"tidy-notes",title:"Tidy notes",request:"User requested bounded document maintenance",executor:"coordinator",milestone:null,sources:["policy.md"],write_scope:["notes.md"],plan:["Tidy notes"],
    document_impacts:Object.fromEntries(["product","design","technical","verification","handoff"].map(k=>[k,{status:"none",reason:"Fixture has no formal product documents"}])),document_tasks:[],acceptance:[{id:"AC1",description:"Notes preserve constraints",verification:"inspection"}]});
  quick.change(root,task.id,"start");
  write(root,"lock.json",makeLock(policy,catalog,"fixture approval"));
  const packet={task_id:"tidy-notes",objective:"Remove duplicate lines preserving approved constraints",inputs:["policy.md","notes.md"],write_scope:["notes.md"],acceptance:["Preserve the approved constraints"],risk:"normal",risk_reason:"Only duplicate wording, no new decisions"};
  write(root,"packet.json",packet);
  const call=(command,extra=[],env={})=>spawnSync(process.execPath,[cli,command,"--project",root,...extra],{encoding:"utf8",env:{...process.env,AGT_TEST_OUTPUT:join(root,"executed.json"),...env}});
  const args=["--lock",join(root,"lock.json"),"--packet",join(root,"packet.json"),"--task","documentation","--quick",task.id,"--role","frontend-implementer/base","--codex",stub];
  const receipt=(attempt,outcome)=>{write(root,"receipt.json",{attempt,outcome,summary:"Reviewed fixture evidence",evidence:["policy.md"],runtime_id:`runtime-${attempt}`});return call("record",["--task-id",packet.task_id,"--receipt",join(root,"receipt.json")]);};
  return {root,packet,task,args,call,receipt};
}
test("Quick native dispatch routes a bounded task with no active milestone role",t=>{
  const f=fixture(t),state=readFileSync(join(f.root,".planning/workflow/state.yaml")),locked=readFileSync(join(f.root,"lock.json"));
  const r=f.call("dispatch",f.args);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);
  assert.equal(d.spawn.model,"gpt-6-luna");assert.equal(d.spawn.reasoning_effort,"medium");assert.equal(d.spawn.fork_turns,"none");assert.equal(d.spawn.task_name,"tidy_notes_a1");
  assert.match(d.spawn.message,/delegated portion of AGT Quick/);assert.doesNotMatch(d.spawn.message,/Use \$agt-frontend-implement/);
  assert.ok(d.spawn.message.includes(`Target product/worktree root: ${realpathSync(f.root)}`));
  assert.equal(d.actual_model,"not_observed");assert.equal(existsSync(join(f.root,"executed.json")),false);
  assert.deepEqual(readFileSync(join(f.root,".planning/workflow/state.yaml")),state);assert.deepEqual(readFileSync(join(f.root,"lock.json")),locked);
  assert.equal(f.call("dispatch",f.args).status,1);
});
test("project subdirectories use the same root for Quick scope, input paths, ledger and execution",t=>{
  const f=fixture(t);mkdirSync(join(f.root,"sub"));
  // Root policy.md and notes.md exist; neither exists in sub/.
  const call=(command,args)=>spawnSync(process.execPath,[cli,command,"--project",join(f.root,"sub"),...args],{encoding:"utf8",env:{...process.env,AGT_TEST_OUTPUT:join(f.root,"executed.json")}});
  const r=call("launch",[...f.args,"--run"]);assert.equal(r.status,0,r.stderr);
  const executed=readJson(join(f.root,"executed.json"));assert.equal(executed.args[executed.args.indexOf("-C")+1],realpathSync(f.root));
  assert.ok(executed.input.includes(`Target product/worktree root: ${realpathSync(f.root)}`));
  assert.equal(existsSync(join(f.root,"sub/.planning")),false);
  const status=call("status",["--task-id",f.packet.task_id]);assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).attempts.length,1);
});
test("native receipts drive persistent retries and cannot be overridden with --failures",t=>{
  const f=fixture(t);
  for(const [index,outcome] of ["environment_failure","implementation_failure","implementation_failure"].entries()) {
    const r=f.call("dispatch",f.args);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).route.tier,"economy");
    const receipt=f.receipt(index+1,outcome);assert.equal(receipt.status,0,receipt.stderr);
  }
  const r=f.call("dispatch",f.args);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);
  assert.equal(d.route.tier,"balanced");assert.equal(d.route.failures,2);assert.match(d.spawn.message,/environment_failure/);assert.equal(d.spawn.task_name,"tidy_notes_a4");
  assert.equal(f.call("dispatch",[...f.args,"--failures","0"]).status,1);
  const status=f.call("status",["--task-id",f.packet.task_id]);assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).failures,2);
});
test("Quick dispatch rejects writes outside scope and tasks which are not active",t=>{
  const f=fixture(t);write(f.root,"packet.json",{...f.packet,write_scope:["outside.md"]});
  let r=f.call("dispatch",f.args);assert.equal(r.status,1);assert.match(r.stderr,/exceeds/);
  write(f.root,"packet.json",f.packet);quick.change(f.root,f.task.id,"block",{reason:"Fixture blocker"});
  r=f.call("dispatch",f.args);assert.equal(r.status,1);assert.match(r.stderr,/active/);assert.equal(existsSync(join(f.root,".planning/agt/model-runs")),false);
});
test("read-only document review launches strong, captures usage, and still needs review receipt",t=>{
  const f=fixture(t);write(f.root,"packet.json",{...f.packet,task_id:"review-notes",read_only:true,write_scope:[]});
  const args=[...f.args];args[args.indexOf("--task")+1]="document-review";args[args.indexOf("--role")+1]="quality/base";
  const preview=f.call("launch",args);assert.equal(preview.status,0,preview.stderr);assert.equal(existsSync(join(f.root,".planning/agt/model-runs")),false);
  const r=f.call("launch",[...args,"--run"]);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout).attempts[0];
  assert.equal(d.requested_model,"gpt-6.1-sol");assert.equal(d.outcome,null);assert.equal(d.execution,"completed_needs_review");assert.equal(d.actual_model,"not_observed");
  assert.equal(d.usage.input_tokens,100);assert.equal(d.runtime_id,"fixture-runtime");
  const executed=readJson(join(f.root,"executed.json"));assert.ok(executed.args.includes("--json"));assert.equal(executed.args[executed.args.indexOf("--sandbox")+1],"read-only");
});
test("archive commands need no model discovery or model attempt",t=>{
  const f=fixture(t),args=[...f.args];args[args.indexOf("--task")+1]="archive-execution";args[args.indexOf("--codex")+1]="/nonexistent-codex";
  const r=f.call("dispatch",args);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).route.mode,"tool");assert.equal(existsSync(join(f.root,".planning/agt/model-runs")),false);
});
test("legacy preview remains read-only while real launch requires a traceable task ID",t=>{
  const f=fixture(t);const packet={...f.packet};delete packet.task_id;delete packet.risk_reason;write(f.root,"packet.json",packet);
  const preview=f.call("launch",f.args);assert.equal(preview.status,0,preview.stderr);
  const run=f.call("launch",[...f.args,"--run"]);assert.equal(run.status,1);assert.match(run.stderr,/task_id/);assert.equal(existsSync(join(f.root,"executed.json")),false);
});
