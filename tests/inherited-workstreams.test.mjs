import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, readYaml, CONFIG } from '../adapters/workstreams/context.mjs';
import * as ws from '../adapters/workstreams/workstreams.mjs';

const profile = resolve('profiles/consumer-ai-web/PROFILE.yaml');
const write = (root,path,value) => { mkdirSync(resolve(root,path,'..'),{recursive:true}); writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value)); };
const commit = root => { git(root,['add','.']); git(root,['commit','-m','fixture']); return git(root,['rev-parse','HEAD']); };
function fixture(t) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'agt-inherited-'))),root=join(dir,'product');mkdirSync(root);t.after(()=>rmSync(dir,{recursive:true,force:true}));
  git(root,['init','-b','main']);git(root,['config','user.name','Test']);git(root,['config','user.email','fixture@example.invalid']);git(root,['config','commit.gpgsign','false']);
  write(root,'.planning/agt/project.yaml',{profile:{id:'consumer-ai-web',version:readYaml(profile).version},agt:{git_revision:'approved-fixture'}});
  write(root,'.planning/agt/agents.yaml',{agents:[{role:'product/to-c',display_name:'product-maya',status:'active'}]});
  write(root,'.planning/workflow/state.yaml',{milestone:'M003',stage:'product-planning',status:'active',active_role:'product/to-c',active_agent:'product-maya'});
  write(root,'docs/deployment.md','Fixture only.');write(root,'app.txt','baseline');commit(root);
  git(root,['switch','-c','integration/m003-growth-import']);
  ws.enable(root,{profile,target:'integration/m003-growth-import',milestone:'M003',approval:'Original legacy adoption'});commit(root);
  const old=ws.create(root,{id:'growth-import',title:'Growth import',scope:'Previously delivered import',agent:'product-alice'});
  write(old.worktree,'growth.txt','Previously delivered growth behavior');
  const source_commit=commit(old.worktree), oldMetadata=readFileSync(join(old.worktree,'.planning/milestones/M003/workstreams/growth-import/workstream.json'));
  git(root,['merge','--no-ff',old.branch,'-m','legacy integration']);const integration_commit=git(root,['rev-parse','HEAD']);
  git(root,['switch','main']);git(root,['merge','--no-ff','integration/m003-growth-import','-m','previous main delivery']);
  rmSync(join(root,CONFIG));write(root,'.agt/delivery.json',{schema_version:2,planning_storage:'branch',main_branch:'main',adoption_source:'User approved migration',deployment_document:'docs/deployment.md'});commit(root);
  git(root,['switch','-c','milestone/M003']);
  return {root,dir,old,oldMetadata,item:{id:'growth-import',source_commit,integration_commit}};
}
function enable(root,inherited_workstreams) { return ws.enable(root,{profile,target:'milestone/M003',milestone:'M003',approval:'User approved inherited workstreams',inherited_workstreams}); }

test('v2 parent explicitly inherits v1 integrated child without rewriting or reactivating it',t=>{
  const {root,dir,old,oldMetadata,item}=fixture(t);
  const input=join(dir,'inherited.json');writeFileSync(input,JSON.stringify([item]));
  const run=spawnSync(process.execPath,[resolve('adapters/workstreams/agt-workstream.mjs'),'enable','--project',root,'--profile',profile,'--target','milestone/M003','--milestone','M003','--approval','User migration','--inherited',input],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);commit(root);
  const row=ws.list(root).find(x=>x.id===item.id);assert.equal(row.historical,true);assert.equal(row.retired,true);assert.equal(row.integrated,true);assert.equal(row.active_agent,null);
  assert.equal(row.integration.source_commit,item.source_commit);assert.equal(row.integration.integration_commit,item.integration_commit);
  assert.throws(()=>ws.claim(root,{id:item.id,owner:'new session',pid:process.pid}),/retired/);
  assert.throws(()=>ws.claim(old.worktree,{id:item.id,owner:"legacy session",pid:process.pid}),/retired/);
  assert.throws(()=>ws.resume(old.worktree,{id:item.id}),/retired/);
  assert.throws(()=>ws.resume(root,{id:item.id}),/retired/);assert.throws(()=>ws.integrate(root,{id:item.id}),/retired/);
  assert.throws(()=>ws.cleanup(root,{id:item.id}),/retired/);
  const next=ws.create(root,{id:'next-import',title:'Next import',scope:'New scoped change',agent:'product-bob',dependencies:[item.id]});
  assert.equal(ws.list(next.worktree).find(x=>x.id===item.id).integrated,true);
  assert.equal(git(old.worktree,['rev-parse','HEAD']),item.source_commit);assert.deepEqual(readFileSync(join(old.worktree,'.planning/milestones/M003/workstreams/growth-import/workstream.json')),oldMetadata);
});

test('moved inherited source remains visible and blocks reuse or new dependencies',t=>{
  const {root,old,item}=fixture(t);enable(root,[item]);commit(root);
  write(old.worktree,'late.txt','New work after historical migration');const later=commit(old.worktree);
  const row=ws.list(root).find(x=>x.id===item.id);assert.equal(row.integrated,false);assert.equal(row.observed_source,later);assert.equal(row.integration_error,'inherited_source_changed');
  assert.throws(()=>ws.create(root,{id:'dependent',title:'Dependent',scope:'New change',agent:'product-bob',dependencies:[item.id]}),/Inherited dependency changed/);
  assert.throws(()=>ws.create(root,{id:item.id,title:'Reuse',scope:'Invalid',agent:'product-bob'}),/retired/);
});

test('inherited snapshots must prove integration into the adopted parent',t=>{
  const {root,old,item}=fixture(t);write(old.worktree,'unmerged.txt','Not yet integrated');const unmerged=commit(old.worktree);
  assert.throws(()=>enable(root,[{...item,source_commit:unmerged,integration_commit:unmerged}]),/inherited_integration_not_in_parent/);
  assert.equal(existsSync(join(root,CONFIG)),false);
  assert.throws(()=>enable(root,[item]),/inherited_source_changed/);
  assert.throws(()=>enable(root,[item,item]),/unique IDs/);
});
