import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { git, readYaml, resolveContext, artifacts, parentId } from '../adapters/workstreams/context.mjs';
import * as quick from '../adapters/quick/quick-tasks.mjs';
import * as streams from '../adapters/workstreams/workstreams.mjs';
import * as delivery from '../adapters/delivery/delivery.mjs';

const profile = resolve('profiles/consumer-ai-web/PROFILE.yaml');
const write = (root, path, value) => { mkdirSync(resolve(root, path, '..'), {recursive:true}); writeFileSync(join(root,path), typeof value === 'string' ? value : JSON.stringify(value)); };
const commit = root => { git(root,['add','.']); git(root,['commit','-m','fixture']); return git(root,['rev-parse','HEAD']); };
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(),'agt-branch-workflows-'))), root=join(dir,'product'); mkdirSync(root);
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(root,['init','-b','main']); git(root,['config','user.name','Test']); git(root,['config','user.email','test@example.invalid']); git(root,['config','commit.gpgsign','false']);
  write(root,'.planning/agt/project.yaml',{profile:{id:'consumer-ai-web',version:readYaml(profile).version},agt:{git_revision:'approved-base'}});
  write(root,'.planning/agt/agents.yaml',{agents:[{role:'product/to-c',display_name:'product-maya',status:'active'}]});
  write(root,'.planning/workflow/state.yaml',{milestone:'M001',stage:'product-planning',status:'active',active_role:'product/to-c',active_agent:'product-maya'});
  write(root,'.planning/agt/quick-tasks.json',{schema_version:1,enabled:true,adoption_source:'User confirmed semantic closeout'});
  write(root,'docs/deployment.md','Not configured.\n'); write(root,'app.txt','baseline\n'); write(root,'policy.md','Confirmed behavior.\n');
  write(root,'.agt/delivery.json',{schema_version:2,planning_storage:'branch',main_branch:'main',adoption_source:'User approved branch delivery',deployment_document:'docs/deployment.md'});
  commit(root); return {root,dir};
}
function spec() {
  return {slug:'fix-label',title:'Fix label',request:'User: fix label',executor:'frontend-alice',milestone:null,sources:['policy.md'],write_scope:['app.txt'],plan:['Implement and verify'],acceptance:[{id:'AC1',description:'Label works',verification:'command'}],document_impacts:Object.fromEntries(['product','design','technical','verification','handoff'].map(d=>[d,{status:'none',reason:'No contract changes'}])),document_tasks:[]};
}
const checks = code => [{criteria:['AC1'],argv:[process.execPath,'-e',code||'process.exit(0)']}];
function compact(root,id) {
  quick.compact(root,id,{outcome:'Label fixed',rationale:'Requested correction',verification_scope:'AC1',limitations:'Fixture only',decisions:[{summary:'User request',source:'task.request'}],retained_items:[],documents:[]});
}
function review(root,id) {
  delivery.review(root,id,{reviewer:'delivery-jordan',outcome:'Final scoped result',verification:'Final checks passed',limitations:'Fixture only',retained_items:[],materials:delivery.inventory(root,id).filter(f=>f.path!==`.planning/quick/${id}/task.json`).map(f=>({path:f.path,disposition:'current',reason:'Final effective material'}))});
}
function ready(root) {
  const ctx=resolveContext(root), parent=parentId(ctx.config), state=readYaml(join(root,ctx.state));
  // Final artifacts are supplied; stage-only handoffs are deliberately absent.
  for(const path of artifacts(ctx.config.profile,parent,ctx.id,'final')) write(root,path,`Final effective ${path}\n`);
  Object.assign(state,{stage:ctx.config.profile.workflow.terminal_stage,status:'completed',active_role:null,active_agent:null,pending_user_decisions:[],open_change_requests:[]}); write(root,ctx.state,state);
  const approval=`${ctx.artifact_root}/reviews/final.md`, evidence=`${ctx.artifact_root}/verification/report.md`;
  write(root,approval,'User accepted final scope.'); write(root,evidence,'Final validation passed.'); commit(root);
  const id=`${parent}${ctx.config.parent.kind==='quick'?'--':'-'}${ctx.id}`; review(root,id);
  const lease=streams.claim(root,{id:ctx.id,owner:'fixture',pid:process.pid});
  streams.accept(root,{token:lease.token,approval,decision:'ACCEPT-FINAL',evidence:[evidence]});
  streams.release(root,{id:ctx.id,token:lease.token}); return ctx;
}

test('branch Quick creates its own branch, discards failed history and completes without compressed originals',t=>{
  const {root}=fixture(t), baseline=git(root,['rev-parse','main']);
  const task=quick.create(root,spec()); assert.equal(git(root,['branch','--show-current']),`quick/${task.id}`);
  quick.change(root,task.id,'start'); write(root,'app.txt','fixed\n');
  assert.throws(()=>quick.verify(root,task.id,checks('process.exit(1)')),/Checks failed/);
  quick.verify(root,task.id,checks()); rmSync(join(root,`.planning/quick/${task.id}/check-1.json`));
  compact(root,task.id); review(root,task.id); quick.change(root,task.id,'finish');
  const result=quick.show(root,task.id,{history:true});
  assert.equal(result.checks.length,1); assert.equal(result.compaction_now.pass,true); assert.equal(result.validation_now[0].pass,true);
  assert.equal(existsSync(join(root,`.agt/deliveries/${task.id}/archive.json.gz`)),false);
  assert.equal(git(root,['rev-parse','main']),baseline);
  // Later code changes do not retroactively turn accepted task history into failure.
  write(root,'app.txt','later change\n'); assert.equal(quick.show(root,task.id).validation_now[0].pass,true);
});

test('Quick children resolve their parent, integrate ordinarily and cannot write parent Quick state',t=>{
  const {root}=fixture(t), task=quick.create(root,spec()); quick.change(root,task.id,'start'); commit(root);
  streams.enable(root,{profile,target:`quick/${task.id}`,quick:task.id,approval:'User requested parallel child'}); commit(root);
  const child=streams.create(root,{id:'label',title:'Label',scope:'Confirmed label change',agent:'product-alice'});
  const ctx=resolveContext(child.worktree); assert.equal(ctx.config.parent.id,task.id); assert.equal(ctx.artifact_root,`.planning/quick/${task.id}/workstreams/label`);
  assert.throws(()=>quick.change(child.worktree,task.id,'checkpoint',{summary:'wrong scope',next:'wrong'}),/parent|requirement|Quick writes/);
  quick.verify(root,task.id,checks()); compact(root,task.id); review(root,task.id);
  assert.throws(()=>quick.change(root,task.id,'finish'),/Integrate and release/); commit(root);
  write(child.worktree,'label.txt','done\n'); ready(child.worktree);
  streams.integrate(root,{id:'label'}); streams.check(root,{id:'label',commands:[[process.execPath,'-e',"if(!require('node:fs').existsSync('label.txt')) process.exit(1)"]]}); streams.finish(root,{id:'label'});
  assert.equal(streams.list(root)[0].integrated,true); assert.equal(existsSync(join(root,'label.txt')),true);
  quick.change(root,task.id,'checkpoint',{summary:'Child integrated',next:'Final parent verification'});
});

test('milestone branch planning is allowed, stage-only history is optional, and main writes are refused',t=>{
  const {root}=fixture(t); git(root,['switch','-c','milestone/M001']);
  streams.enable(root,{profile,target:'milestone/M001',milestone:'M001',approval:'User adopted'}); commit(root);
  const child=streams.create(root,{id:'feature',title:'Feature',scope:'Confirmed',agent:'product-alice'}); ready(child.worktree);
  assert.equal(streams.list(root)[0].accepted,true);
  assert.equal(existsSync(join(child.worktree,'.planning/milestones/M001/workstreams/feature/handoffs/product.md')),false);
  assert.equal(delivery.checkGit(child.worktree).pass,true);
  git(root,['switch','main']); assert.throws(()=>streams.enable(root,{profile,target:'main',milestone:'M001',approval:'invalid direct main'}),/main writes/);
});

test('closed predecessor documents cannot enter a new Quick write scope',t=>{
  const {root}=fixture(t), path='.planning/milestones/M001/product/overview.md';
  write(root,path,'Closed accepted baseline.');
  write(root,'.agt/deliveries/M001/summary.json',{schema_version:2,id:'M001',closed:true,materials:[]}); commit(root);
  assert.throws(()=>quick.create(root,{...spec(),write_scope:[path]}),/Closed delivery is read-only/);
  assert.equal(git(root,['branch','--show-current']),'main');
  assert.equal(readFileSync(join(root,path),'utf8'),'Closed accepted baseline.');
});
