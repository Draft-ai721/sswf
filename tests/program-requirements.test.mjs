import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requirementAreas,requirementCandidates,validateRequirementSpec} from '../shared/program-requirements.js';
import {areaSummary} from '../shared/design-workflow.js';
import {planMetrics,planIssues} from '../shared/space-planning.js';
import {applyStudioActions,prepareStudio} from '../shared/studio-actions.js';
import {createStudioServer} from '../server/index.mjs';
import {createSeed} from '../src/data.js';

const source={fileId:'brief-pdf',page:2,quote:'阅览室两间，共 120 ㎡'};
const spec={areaBasis:'total',statedAreaM2:120,confirmation:'confirmed',source};
const requirement={id:'reading',name:'阅览室',count:2,area:0,spec};

test('Explicit per-room and total wording stays distinct, and ambiguous text stays manual',()=>{
  const candidates=requirementCandidates(source.quote+'。阅览室两间，各 120 ㎡。展厅两间 200 ㎡');
  assert.deepEqual(candidates.map(({count,areaBasis,statedAreaM2})=>[count,areaBasis,statedAreaM2]),
    [[2,'total',120],[2,'each',120]]);
  assert.equal(requirementAreas(requirement).referenceEachM2,60);
  assert.equal(requirementAreas({...requirement,spec:{...spec,areaBasis:'each'}}).totalM2,240);
  const rounded={...requirement,count:3,spec:{...spec,statedAreaM2:100}};
  assert.equal(areaSummary({program:[rounded],site:{area:200,targetArea:100}}).total,100);
  assert.equal(requirementAreas({...requirement,spec:{...spec,statedAreaM2:0}}).totalM2,0);
  assert.equal(requirementAreas({...requirement,spec:{...spec,statedAreaM2:null}}).totalM2,null);
  assert.equal(requirementAreas({count:2,area:60}).totalM2,120);
});

test('Requirement placement uses stable IDs and issues locate only affected geometry',()=>{
  const p=prepareStudio({id:'requirements',name:'示例'});
  p.workflow.program=[{...requirement,id:'other-room',area:18,spec:undefined},requirement];
  const initial=applyStudioActions(p,[{type:'place_requirement',programId:'reading'}]).project;
  const option=initial.workflow.options[0], first=option.plan.spaces[0];
  assert.equal(first.programId,'reading');
  const gap=planIssues(option.id,planMetrics(option.plan,[requirement])).find(issue=>issue.kind==='requirement');
  assert.deepEqual(gap.spaceIds,[first.id]);assert.equal(gap.requirement.deltaArea,-60);
  const placed=applyStudioActions(initial,[{type:'place_requirement',programId:'reading',x:first.x,y:first.y}]).project;
  const plan=placed.workflow.options[0].plan;
  const issues=planIssues(option.id,planMetrics(plan,[requirement]));
  assert.deepEqual(issues.map(issue=>issue.kind),['overlap']);
  assert.deepEqual(new Set(issues[0].spaceIds),new Set(plan.spaces.map(space=>space.id)));
  plan.spaces[1].x=first.x+first.width;
  assert.deepEqual(planIssues(option.id,planMetrics(plan,[requirement])),[]);
});

test('Source page and normalized region must match the original file type',()=>{
  const files=[{id:source.fileId,type:'pdf'},{id:'scan',type:'png'}];
  const valid={...spec,source:{...source,region:{x:.2,y:.3,width:.5,height:.5}}};
  assert.deepEqual(validateRequirementSpec(valid,files),valid);
  for(const change of [{page:2.5},{page:0},{fileId:'scan'},{quote:''},{region:{x:.9,y:0,width:.2,height:.5}}]){
    assert.throws(()=>validateRequirementSpec({...spec,source:{...source,...change}},files));
  }
});

test('Server derives the compatibility area and prevents foreign references and legacy data loss',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-requirements-'));
  const origin='https://studio.test',token='requirements-token-'.repeat(3);
  const app=await createStudioServer({dataDir:dir,origin,bootstrapToken:token});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})});
  let cookie='';
  const request=(url,method='GET',body,headers={})=>app.handle(new Request(origin+url,{method,body,headers:{Origin:origin,cookie,...headers}}));
  const login=await request('/api/auth/setup','POST',JSON.stringify({token,email:'student@example.test',name:'学生',password:'test-password-123'}));
  cookie=login.headers.get('set-cookie').split(';')[0];
  const projectState=createSeed(), p=prepareStudio(projectState.projects[0]);
  projectState.projects[0]=p;
  const start=await request('/api/state','PUT',JSON.stringify(projectState),{'If-None-Match':'*'});
  assert.ok(start.ok);
  const upload=await request('/api/files?name=brief.pdf&project='+p.id,'POST','%PDF-1.4');
  assert.ok(upload.ok);
  const {file}=await upload.json();p.files.push(file);
  const initial=await start.json();
  const modern={'X-Plan-Requirements':'1','If-Match':initial.etag};
  p.workflow.program=[{...requirement,area:999,spec:{...spec,source:{...source,fileId:file.id}}}];
  const saved=await request('/api/state','PUT',JSON.stringify(projectState),modern);
  assert.ok(saved.ok,await saved.clone().text());
  const stored=await (await request('/api/state')).json();
  const row=stored.state.projects[0].workflow.program[0];
  assert.equal(row.area,60);assert.equal(row.spec.source.page,2);
  const stale=structuredClone(stored.state);delete stale.projects[0].workflow.program[0].spec;
  assert.equal((await request('/api/state','PUT',JSON.stringify(stale),{'If-Match':stored.etag})).status,409);
  const foreign=structuredClone(stored.state);
  foreign.projects[0].files.push({id:'missing-pdf',type:'pdf'});
  foreign.projects[0].workflow.program[0].spec.source.fileId='missing-pdf';
  assert.equal((await request('/api/state','PUT',JSON.stringify(foreign),{...modern,'If-Match':stored.etag})).status,400);
});
