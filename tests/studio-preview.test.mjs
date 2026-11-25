import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStudio,applyStudioActions,copyOption,captureDraft,DraftHistory} from '../shared/studio-actions.js';
import {previewStudioActions,compareSpaces} from '../shared/studio-preview.js';
import {validatePlan} from '../shared/space-planning.js';
import {optionComparison} from '../src/studio-comparison.js';
import {workflowSections} from '../src/workflow-report.js';

function sample(){
  const project=prepareStudio({name:'阅览亭',files:[]});
  return applyStudioActions(project,[{type:'add_space',name:'阅览室',area:20}]).project;
}

test('Copy preview remaps source targets and reuses stable identifiers on replay',()=>{
  const project=sample(), source=project.workflow.options[0], space=source.plan.spaces[0];
  const commands=[{type:'update_space',targetId:space.id,height:5},{type:'add_space',name:'交流区',area:20}];
  const context={optionId:source.id,spaceIds:[space.id]};
  const ids=[];
  const result=previewStudioActions(project,commands,context,'copy',()=>{
    const id='allocated-'+ids.length;ids.push(id);return id;
  });
  let index=0;
  assert.deepEqual(previewStudioActions(project,commands,context,'copy',()=>ids[index++]),result);
  assert.deepEqual(result.project.workflow.options[0],source);
  assert.equal(result.project.workflow.selectedOptionId,project.workflow.selectedOptionId);
  assert.equal(result.project.workflow.options[1].plan.spaces[0].sourceSpaceId,space.id);
  assert.deepEqual(result.preview.changes.map(c=>c.kind),['updated','added']);
  assert.equal(result.preview.beforeMetrics.area,20);
  assert.equal(result.preview.afterMetrics.area,40);
  assert.equal(result.project.workflow.options[1].plan.spaces[0].height,5);
  assert.equal(project.workflow.options.length,1);
  const history=new DraftHistory();history.record(captureDraft(project),captureDraft(result.project));
  assert.deepEqual(captureDraft(history.step(result.project).project),captureDraft(project));
  assert.throws(()=>previewStudioActions(project,[...commands,{type:'delete_space',targetId:'missing'}],context,'copy',()=>crypto.randomUUID()));
  assert.equal(project.workflow.options.length,1);
});

test('Comparison matches lineage, renders one-sided changes and keeps both figures at the same scale',()=>{
  const project=sample(), a=project.workflow.options[0], b=copyOption(a,'方案 B');
  a.plan.spaces.push({...a.plan.spaces[0],id:'room-a-only',x:8});
  b.plan.spaces.push({...b.plan.spaces[0],id:'room-b-only',x:12});
  delete b.plan.spaces[1].sourceSpaceId;
  b.plan.depth=40;
  const pairs=compareSpaces(a.plan,b.plan);
  assert.deepEqual(pairs.map(pair=>[!!pair.before,!!pair.after]),[[true,true],[true,false],[false,true]]);
  assert.throws(()=>validatePlan({...b.plan,spaces:[...b.plan.spaces,{...b.plan.spaces[0],id:'fake'}]},project.workflow.program));
  project.workflow.options.push(b);
  project.workflow.compareWithId=b.id;project.workflow.choiceReason='保留入口流线';
  const common=html=>{
    const boxes=[...html.matchAll(/viewBox="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(boxes.length,2);assert.equal(boxes[0],boxes[1]);
  };
  common(optionComparison(a,b,project.workflow.program,[],{mode:'plan'}));
  common(optionComparison(a,b,project.workflow.program,[],{mode:'axon',camera:{yaw:1,pitch:.4}}));
  assert.match(workflowSections(project),/同尺度方案对照/);
  assert.match(workflowSections(project),/保留入口流线/);
});
