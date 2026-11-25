import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateUnderlay,validateUnderlay} from '../shared/plan-underlay.js';
import {applyStudioActions,prepareStudio,captureDraft,DraftHistory} from '../shared/studio-actions.js';
import {planSvg} from '../shared/space-planning.js';
import {validateWorkflow} from '../worker/workflow-validation.js';
import {workflowSections} from '../src/workflow-report.js';

const u={fileId:'map',sourceFileId:'map',page:1,width:1000,height:500,x:2,y:3,
  scale:.03,rotation:30,opacity:.5,locked:true};
function project() {
  return prepareStudio({id:'p',name:'底图',files:[{id:'map',type:'png',name:'场地图'}]});
}
test('Calibration anchors the first world point, preserves rotation and leaves geometry unchanged',()=>{
  const scaled=calibrateUnderlay(u,[5,6],[15,6],20);
  assert.equal(scaled.scale,.06); assert.equal(scaled.x,-1); assert.equal(scaled.y,0);
  assert.equal(scaled.rotation,30);
  assert.throws(()=>calibrateUnderlay(u,[5,6],[5,6],20));
  assert.throws(()=>calibrateUnderlay(u,[5,6],[15,6],NaN));
  for(const patch of [{fileId:'../x'},{scale:0},{width:Infinity},{locked:'true'},{opacity:2}]) {
    assert.throws(()=>validateUnderlay({...u,...patch}));
  }
});
test('Underlay survives validation, independent copies and undo without changing ink or spaces',()=>{
  const p=project(), added=applyStudioActions(p,[{type:'set_underlay',underlay:u}]).project;
  const normalized=validateWorkflow(added.workflow,p.workflow,added);
  assert.deepEqual(normalized.options[0].plan.underlay,u);
  const history=new DraftHistory();history.record(captureDraft(p),captureDraft(added));
  assert.equal(history.step(added).project.workflow.options[0].plan.underlay,undefined);
  const copy=applyStudioActions(added,[{type:'duplicate_option'}]).project;
  copy.workflow.options[1].plan.underlay.x=99;
  assert.equal(copy.workflow.options[0].plan.underlay.x,2);
  assert.throws(()=>applyStudioActions(p,[{type:'set_underlay',underlay:{...u,fileId:'foreign'}}]));
  const invalid=structuredClone(added);invalid.workflow.options[0].plan.underlay.sourceFileId='foreign';
  assert.throws(()=>validateWorkflow(invalid.workflow,p.workflow,invalid));
  const pdf=structuredClone(added);
  pdf.files.push({id:'source-pdf',type:'pdf'});
  pdf.files[0].derivedFrom={fileId:'source-pdf',page:2};
  pdf.workflow.options[0].plan.underlay={...u,sourceFileId:'source-pdf',page:2};
  assert.equal(validateWorkflow(pdf.workflow,p.workflow,pdf).options[0].plan.underlay.page,2);
  pdf.workflow.options[0].plan.underlay.page=3;
  assert.throws(()=>validateWorkflow(pdf.workflow,p.workflow,pdf));
});
test('Review rendering resolves underlays through the authorized snapshot resource route',()=>{
  const p=applyStudioActions(project(),[{type:'set_underlay',underlay:u}]).project;
  assert.match(planSvg(p.workflow.options[0].plan),/translate\(2 3\) rotate\(30\) scale\(0.03\)/);
  const html=workflowSections(p,{fileUrl:id=>'/api/review-rooms/room/files/'+id});
  assert.match(html,/href="\/api\/review-rooms\/room\/files\/map"/);
  assert.doesNotMatch(html,/href="\/api\/files\/map/);
});
