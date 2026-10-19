import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { readJson, validatePolicy, normalizeCatalog, resolveRoute, makeLock, validateLock, checkUpdates, writeNewLock, discoverModels, readActiveState, validatePacket, launchSpec } from "../adapters/codex/model-router.mjs";

const root = resolve(import.meta.dirname, "..");
const policy = readJson(join(root, "models/codex-balanced.json"));
const catalog = normalizeCatalog([...new Set(Object.values(policy.bindings).map(b => b.model))].map(model => ({ model, supportedReasoningEfforts: [{reasoningEffort:"medium"},{reasoningEffort:"high"}] })), "codex-cli fixture");
const stub = join(root, "tests/fixtures/codex-stub.mjs");
const clone = v => structuredClone(v);
const route = o => resolveRoute(policy, catalog, {stage:"implementation",role:"frontend-implementer/base",task:"coding",...o});
function temporary(t) { const dir = mkdtempSync(join(tmpdir(), "agt-routing-test-")); t.after(() => rmSync(dir, {recursive:true,force:true})); return dir; }

test("policy has valid explicit tiers", () => assert.equal(validatePolicy(policy), policy));
for (const [role,r] of Object.entries(policy.roles)) test("stage default: "+role, () => {
 const actual = resolveRoute(policy,catalog,{stage:r.stage,role});
 assert.equal(actual.model,policy.bindings[r.tier].model);
 assert.equal(actual.effort,policy.bindings[r.tier].effort);
});
for (const task of ["coding","mechanical","unit-tests","initial-fix","documentation"]) test(task+" uses economy for normal work", () => assert.equal(route({task}).model,"gpt-6-luna"));
test("planning/review/debug remain strong", () => {for(const task of ["plan","code-review","debug","test-design"])assert.equal(route({task}).model,"gpt-6.1-sol");});
test("high risk has strong floor even for mechanical edits", () => assert.equal(route({task:"mechanical",risk:"high"}).model,"gpt-6.1-sol"));
test("critical risk goes directly to frontier", () => assert.equal(route({risk:"critical"}).model,"gpt-6-astra"));
test("failure escalation is bounded and monotonic", () => {
 assert.deepEqual([0,1,2,4,6].map(failures=>route({failures}).tier),["economy","economy","balanced","strong","frontier"]);
 assert.deepEqual([0,2,4,6].map(failures=>{const r=route({failures});return [r.model,r.effort];}),[
  ["gpt-6-luna","medium"],["gpt-6.1-sol","medium"],["gpt-6.1-sol","high"],["gpt-6-astra","high"]
 ]);
 for(const failures of [-1,1.5,8,100])assert.throws(()=>route({failures}),/ceiling/);
});
test("tool commands need no model/catalog", () => assert.equal(resolveRoute(policy,null,{stage:"implementation",role:"frontend-implementer/base",task:"test-execution"}).mode,"tool"));
test("unknown role, task, risk and stage mismatch rejected", () => {
 for(const options of [{role:"__proto__"},{task:"__proto__"},{stage:"verification"},{risk:"cheap"}])assert.throws(()=>route(options));
 assert.throws(()=>resolveRoute(policy,catalog,{stage:"verification",role:"quality/base",task:"coding"}));
});
test("missing model never falls back", () => {
 const c=clone(catalog);c.models=c.models.filter(m=>m.model!=="gpt-6-luna");
 assert.throws(()=>resolveRoute(policy,c,{stage:"implementation",role:"frontend-implementer/base",task:"coding"}),/unavailable/);
});
test("unsupported effort fails rather than lowering effort", () => {
 const c=clone(catalog);c.models.find(m=>m.model==="gpt-6-luna").efforts=["high"];
 assert.throws(()=>resolveRoute(policy,c,{stage:"implementation",role:"frontend-implementer/base",task:"coding"}),/Unsupported/);
});
test("ultra is allowed only when the selected model advertises support", () => {
 const p=clone(policy),c=clone(catalog);p.bindings.strong.effort="ultra";
 assert.equal(validatePolicy(p),p);
 const options={stage:"implementation",role:"frontend-implementer/base",task:"plan"};
 assert.throws(()=>resolveRoute(p,c,options),/Unsupported reasoning effort/);
 assert.throws(()=>makeLock(p,c,"ultra-review"),/unavailable model\/effort/);
 c.models.find(m=>m.model==="gpt-6.1-sol").efforts.push("ultra");
 const r=resolveRoute(p,c,options);assert.equal(r.effort,"ultra");assert.equal(r.model,"gpt-6.1-sol");
 const lock=makeLock(p,c,"ultra-review");assert.equal(validateLock(lock),lock);
 const result=checkUpdates(lock,catalog,p);assert.equal(result.action,"blocked_until_review");
 assert.ok(result.issues.some(issue=>issue.reason==="effort_unavailable"&&issue.effort==="ultra"));
 p.bindings.economy.effort="ultra";
 assert.throws(()=>resolveRoute(p,c,{...options,task:"coding"}),/Unsupported reasoning effort for gpt-6-luna/);
 assert.throws(()=>makeLock(p,c,"unsupported-luna-ultra"),/unavailable model\/effort/);
});
test("unknown reasoning levels remain invalid policy values", () => {
 const p=clone(policy);p.bindings.strong.effort="ultra-typo";
 assert.throws(()=>validatePolicy(p),/Invalid binding/);
});
test("hidden, missing efforts, duplicates, malformed catalogs", () => {
 assert.throws(()=>normalizeCatalog([{model:"x",hidden:true}]));
 assert.throws(()=>normalizeCatalog([{model:"x"}]));
 assert.throws(()=>normalizeCatalog([{model:"x",supportedReasoningEfforts:["high"]},{model:"x",supportedReasoningEfforts:["high"]}]));
});
test("lock requires approval, validates hash, and cannot overwrite", t => {
 const dir=temporary(t),file=join(dir,"lock.json");
 assert.throws(()=>makeLock(policy,catalog,""),/approval/);
 const lock=makeLock(policy,catalog,"explicit-test-approval");writeNewLock(file,lock);
 assert.throws(()=>writeNewLock(file,lock),/EEXIST/);
 const edited=clone(lock);edited.policy.bindings.economy.model="different";assert.throws(()=>validateLock(edited),/integrity/);
 assert.equal(readJson(file).policy.bindings.economy.model,"gpt-6-luna");
});
test("updates detect versions, new models, removals, capabilities and upgrades without mutation", () => {
 const lock=makeLock(policy,catalog,"test"), before=JSON.stringify(lock),c=clone(catalog);
 c.codex_version="codex-cli newer";c.models[0].upgrade="gpt-future";c.models[0].efforts.push("max");c.models.push({model:"gpt-future",efforts:["high"],upgrade:null});
 let result=checkUpdates(lock,c,policy);assert.equal(result.codex_version_changed,true);assert.equal(result.upgrades.length,1);assert.equal(result.capability_changes.length,1);assert.deepEqual(result.added_models,["gpt-future"]);
 assert.equal(result.automatic_rebinding,false);assert.equal(JSON.stringify(lock),before);
 c.models=c.models.filter(m=>m.model!=="gpt-6-luna");result=checkUpdates(lock,c,policy);assert.equal(result.action,"blocked_until_review");
 const next=clone(policy);next.bindings.strong.model="gpt-future";assert.equal(checkUpdates(lock,c,next).policy_changed,true);
});
test("legacy locks retain their model bindings when the central policy changes", t => {
 const dir=temporary(t),legacy=clone(policy);
 legacy.version="1.0.0";legacy.verified_at="2026-09-07";
 legacy.bindings={economy:{model:"gpt-5.6-luna",effort:"medium"},balanced:{model:"gpt-5.6-terra",effort:"medium"},strong:{model:"gpt-5.6-sol",effort:"high"},frontier:{model:"gpt-6-astra",effort:"high"}};
 const compatible=clone(catalog);
 for(const model of ["gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol"])compatible.models.push({model,efforts:["medium","high"],upgrade:null});
 const lock=makeLock(legacy,compatible,"previous-policy-approval"),before=JSON.stringify(lock);
 const update=checkUpdates(lock,compatible,policy);
 assert.equal(update.policy_changed,true);assert.deepEqual(update.issues,[]);assert.equal(update.automatic_rebinding,false);
 for(const [role,r] of Object.entries(legacy.roles))assert.equal(resolveRoute(lock.policy,compatible,{stage:r.stage,role}).model,legacy.bindings[r.tier].model);
 assert.equal(checkUpdates(lock,catalog,policy).action,"blocked_until_review");
 const lockPath=join(dir,"legacy.lock.json"),inventory=join(dir,"catalog.json");
 writeNewLock(lockPath,lock);writeFileSync(inventory,JSON.stringify(compatible));
 const r=spawnSync(process.execPath,[join(root,"adapters/codex/agt-models.mjs"),"resolve","--stage","implementation","--role","frontend-implementer/base","--task","coding","--lock",lockPath,"--inventory",inventory,"--codex","/nonexistent-codex"],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).model,"gpt-5.6-luna");
 assert.equal(JSON.stringify(lock),before);assert.equal(JSON.stringify(readJson(lockPath)),before);
});
test("metadata discovery paginates and sends no model-turn request", async () => {
 const c=await discoverModels(stub);assert.equal(c.models.length,4);assert.equal(c.codex_version,"codex-cli fixture");
 assert.ok(c.models.find(m=>m.model==="gpt-6.1-sol").efforts.includes("ultra"));
 assert.ok(!c.models.find(m=>m.model==="gpt-6-luna").efforts.includes("ultra"));
});
for(const scenario of ["error","malformed","cycle","timeout"])test("discovery rejects "+scenario,async()=>{
 process.env.AGT_TEST_SCENARIO=scenario;
 try{await assert.rejects(discoverModels(stub,500));}finally{delete process.env.AGT_TEST_SCENARIO;}
});
test("task packets enforce inputs, acceptance and bounded paths including symlink ancestors",t=>{
 const dir=temporary(t),external=temporary(t);
 const packet={objective:"Fix one view",inputs:["approved.md"],write_scope:["frontend/component.vue"],acceptance:["approved test"],risk:"normal"};
 assert.equal(validatePacket(packet,dir),packet);
 for(const scope of [".","./","..","../elsewhere","/tmp","bad\\path"])assert.throws(()=>validatePacket({...packet,write_scope:[scope]},dir));
 symlinkSync(external,join(dir,"escape"));assert.throws(()=>validatePacket({...packet,write_scope:["escape/new.vue"]},dir),/symlink/);
 symlinkSync(join(external,"missing"),join(dir,"dangling"));assert.throws(()=>validatePacket({...packet,write_scope:["dangling/new.vue"]},dir));
 assert.throws(()=>validatePacket({...packet,acceptance:[]},dir));
 const spec=launchSpec(dir,route({}),packet,root);
 assert.deepEqual(spec.args.slice(0,5),["exec","--model","gpt-6-luna","-c",'model_reasoning_effort="medium"']);
 assert.equal(spec.actual_model,"not_observed");assert.match(spec.prompt,/not alone/);
 assert.ok(!spec.args.some(x=>/bypass|sandbox|approve|add-dir/.test(x)));
});
test("CLI validates state and emits/executes exact selected model without editing state or locks",t=>{
 const project=temporary(t);mkdirSync(join(project,".planning/agt"),{recursive:true});mkdirSync(join(project,".planning/workflow"),{recursive:true});
 const state='stage: implementation\nactive_role: frontend-implementer/base\nactive_agent: frontend-bob\nstatus: active\n';
 const registry='agents:\n  - role: frontend-implementer/base\n    display_name: frontend-bob\n    status: active\n';
 writeFileSync(join(project,".planning/workflow/state.yaml"),state);writeFileSync(join(project,".planning/agt/agents.yaml"),registry);
 assert.equal(readActiveState(project).active_agent,"frontend-bob");
 const lockFile=join(project,"lock.json");writeNewLock(lockFile,makeLock(policy,catalog,"fixture-user-approval"));const originalLock=readFileSync(lockFile,"utf8");
 const packetFile=join(project,"packet.json");writeFileSync(packetFile,JSON.stringify({objective:"Bounded fixture",inputs:["approved.md"],write_scope:["frontend/view.vue"],acceptance:["fixture assertion"],risk:"normal"}));
 const output=join(project,"executed.json");
 const args=[join(root,"adapters/codex/agt-models.mjs"),"launch","--project",project,"--lock",lockFile,"--packet",packetFile,"--task","coding","--codex",stub];
 let r=spawnSync(process.execPath,args,{encoding:"utf8",env:{...process.env,AGT_TEST_OUTPUT:output}});assert.equal(r.status,0,r.stderr);assert.equal(existsSync(output),false);assert.equal(JSON.parse(r.stdout).mode,"dry-run");
 r=spawnSync(process.execPath,[...args,"--run"],{encoding:"utf8",env:{...process.env,AGT_TEST_OUTPUT:output}});
 assert.equal(r.status,0,r.stderr);assert.equal(readJson(output).args[2],"gpt-6-luna");assert.match(readJson(output).input,/\$agt-frontend-implement/);
 r=spawnSync(process.execPath,[...args,"--run"],{encoding:"utf8",env:{...process.env,AGT_TEST_OUTPUT:output,AGT_TEST_EXIT:"17"}});assert.equal(r.status,17);
 assert.equal(readFileSync(lockFile,"utf8"),originalLock);assert.equal(readFileSync(join(project,".planning/workflow/state.yaml"),"utf8"),state);
 const ultraPolicy=clone(policy),ultraCatalog=clone(catalog);ultraPolicy.bindings.strong.effort="ultra";
 ultraCatalog.models.find(m=>m.model==="gpt-6.1-sol").efforts.push("ultra");
 const ultraLock=join(project,"ultra.lock.json");writeNewLock(ultraLock,makeLock(ultraPolicy,ultraCatalog,"explicit-ultra-approval"));
 const ultraArgs=[...args];ultraArgs[ultraArgs.indexOf("--lock")+1]=ultraLock;ultraArgs[ultraArgs.indexOf("--task")+1]="plan";
 r=spawnSync(process.execPath,[...ultraArgs,"--run"],{encoding:"utf8",env:{...process.env,AGT_TEST_OUTPUT:output}});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(readJson(output).args.slice(0,5),["exec","--model","gpt-6.1-sol","-c",'model_reasoning_effort="ultra"']);
 assert.equal(readFileSync(lockFile,"utf8"),originalLock);assert.equal(readFileSync(join(project,".planning/workflow/state.yaml"),"utf8"),state);
 writeFileSync(join(project,".planning/workflow/state.yaml"),state.replace("frontend-bob","frontend-other"));assert.throws(()=>readActiveState(project),/mismatch/);
});
test("CLI refuses unknown flags before invoking Codex",()=>{
 const r=spawnSync(process.execPath,[join(root,"adapters/codex/agt-models.mjs"),"resolve","--dangerously-bypass-approvals-and-sandbox"],{encoding:"utf8"});
 assert.equal(r.status,1);assert.match(r.stderr,/Unknown or duplicate/);
});
test("CLI tool-only resolution works with nonexistent Codex",()=>{
 const r=spawnSync(process.execPath,[join(root,"adapters/codex/agt-models.mjs"),"resolve","--stage","verification","--role","quality/base","--task","test-execution","--codex","/nonexistent-codex"],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).mode,"tool");
});
