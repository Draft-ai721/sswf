import {emptyWorkflow} from './design-workflow.js';
import {outlineFromStroke} from './plan-geometry.js';
import {emptyPlan,validatePlan,planMetrics,round} from './space-planning.js';
import {areaOf,atPosition,boundsOf,isPolygon,outsidePlan,overlapsSpace,validateVertices} from './plan-geometry.js';
export const STUDIO_ACTIONS=['add_space','update_space','delete_space','duplicate_space','duplicate_option','rename_project','set_brief'];
const value=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('尺寸超出可用范围。');return v};
const name=(v,max=80)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('请使用简短、明确的名称。');return v.trim()};
export function newOption(title='方案 A'){return {id:crypto.randomUUID(),title,strategy:'',layout:'',tradeoffs:'',scores:{function:0,flow:0,site:0,public:0,feasibility:0},fileIds:[],findingIds:[],originCandidateId:'',plan:emptyPlan()}}
export function studioOption(p,id=''){const w=p.workflow;return w?.options.find(o=>o.id===id)||w?.options.find(o=>o.id===w.selectedOptionId)||w?.options[0]||null}
export function prepareStudio(p){const next={...p,workflow:structuredClone(p.workflow||emptyWorkflow(p))};if(!next.workflow.options.length){const o=newOption();next.workflow.options.push(o);next.workflow.selectedOptionId=o.id}return next}
export function freePosition(plan, space) {
  const {width,depth} = boundsOf(space);
  let tries = 0;
  for (let y=0; y+depth<=plan.depth && tries<4000; y+=.5) {
    for (let x=0; x+width<=plan.width && tries++<4000; x+=.5) {
      const candidate = atPosition(space,x,y);
      if (!plan.spaces.some(other => overlapsSpace(candidate,other))) return {x,y};
    }
  }
  return null;
}

export function copyOption(option, title) {
  const copy = structuredClone(option);
  copy.id = crypto.randomUUID();
  copy.title = title;
  copy.plan ??= emptyPlan();
  for (const space of copy.plan.spaces) space.id = crypto.randomUUID();
  for (const stroke of copy.plan.strokes||[]) stroke.id = crypto.randomUUID();
  return copy;
}

function addSpace(workflow, plan, action, old) {
  if (plan.spaces.length>=80) throw Error('当前方案已达到80个空间，请先整理。');
  const label = old?.label || workflow.program.find(p=>p.id===old?.programId)?.name ||
    name(action.name||'空间 '+(plan.spaces.length+1));
  let program = old ? workflow.program.find(p=>p.id===old.programId) : workflow.program.find(p=>p.name===label);
  const height = action.height==null ? old?.height||3 : value(action.height,1,30);
  let space, targetArea;
  if (action.type==='add_polygon' || (old && isPolygon(old))) {
    if (['width','depth','area','scale'].some(key => action[key]!=null)) throw Error('请选择并拖动多边形顶点来调整轮廓和面积。');
    const vertices = validateVertices(old?.geometry?.vertices ?? action.vertices);
    space = {geometry:{kind:'polygon',vertices}};
    targetArea = round(areaOf(space));
  } else {
    targetArea = action.area==null ? (old ? areaOf(old) : 20) : value(action.area,.25,1e6);
    const width = action.width==null ? (old?.width||Math.min(5,plan.width,targetArea*2)) : value(action.width,.5,1000);
    const depth = action.depth==null ? (old?.depth||round(targetArea/width)) : value(action.depth,.5,1000);
    space = {x:0,y:0,width:round(width),depth:round(depth)};
  }
  const {width,depth} = boundsOf(space);
  if (depth<.5 || width>plan.width || depth>plan.depth) throw Error('空间超出了当前画布，请调整面积或画布尺寸。');
  if (action.type!=='add_polygon') {
    const position = freePosition(plan,space) || {x:0,y:0};
    space = atPosition(space,action.x==null?position.x:value(action.x,0,1000),action.y==null?position.y:value(action.y,0,1000));
  }
  if (!program) {
    if (workflow.program.length>=80) throw Error('功能清单已达容量上限。');
    program = {id:crypto.randomUUID(),name:label,count:1,area:targetArea,users:'',relation:'',origin:'sketch'};
    workflow.program.push(program);
  }
  return {id:crypto.randomUUID(),programId:program.id,label:old?.label||'',...space,height};
}

function updateSpace(space, action) {
  if (action.name?.trim()) space.label = name(action.name);
  if (action.height!=null) space.height = round(value(action.height,1,30));
  if (isPolygon(space)) {
    if (['width','depth','area','scale'].some(key => action[key]!=null)) throw Error('请选择并拖动多边形顶点来调整轮廓和面积。');
    const bounds = boundsOf(space);
    Object.assign(space, atPosition(space,action.x==null?bounds.x:value(action.x,0,1000),
      action.y==null?bounds.y:value(action.y,0,1000)));
    return;
  }
  for (const key of ['x','y']) if (action[key]!=null) space[key] = round(value(action[key],0,1000));
  for (const key of ['width','depth']) if (action[key]!=null) space[key] = round(value(action[key],.5,1000));
  if (action.area!=null) {
    space.depth = round(value(action.area,.25,1e6)/space.width);
    if (space.depth<.5) throw Error('目标面积过小，请同时调整宽度。');
  }
  if (action.scale!=null) {
    const factor = Math.sqrt(value(action.scale,.1,10));
    space.width = round(space.width*factor);
    space.depth = round(space.depth*factor);
  }
}
export function assistantFacts(p,selection={}){const w=p.workflow||emptyWorkflow(p),o=studioOption(p,selection.optionId);return {projectName:p.name,optionId:o?.id||'',options:w.options.map(o=>({id:o.id,title:o.title})),selectedIds:selection.spaceIds||[],program:w.program,plan:o?.plan||emptyPlan(),metrics:planMetrics(o?.plan||emptyPlan(),w.program,w.relationships||[])}}
export function applyStudioActions(project,actions,selection={},{bounded=true}={}){if(!Array.isArray(actions)||actions.length>10)throw Error('一次最多执行10项设计操作。');const next=prepareStudio(project),w=next.workflow;let o=studioOption(next,selection.optionId);if(selection.optionId&&!w.options.some(o=>o.id===selection.optionId))throw Error('目标方案已经改变，请重新选择。');o.plan??=emptyPlan();const messages=[],created=[],changedIds=[];let optionId=o.id;
for(const action of actions){if(!action||(!STUDIO_ACTIONS.includes(action.type)&&!['add_polygon','move_vertex','draw_stroke','stroke_to_space','move_stroke','delete_stroke'].includes(action.type)))throw Error('助手请求了不支持的操作。');const t=action.type,plan=o.plan;const resolve=()=>{const id=action.targetId||((selection.spaceIds||[]).length===1?selection.spaceIds[0]:'');const s=plan.spaces.find(s=>s.id===id);if(!s)throw Error('请先选中要修改的空间，或明确它的名称。');return s};
if(t==='draw_stroke'){
  (plan.strokes??=[]).push({id:crypto.randomUUID(),points:action.points});
  messages.push('添加了一笔手绘线');
}
else if(t==='stroke_to_space'){
  const stroke=plan.strokes?.find(s=>s.id===action.targetId);
  if(!stroke)throw Error('请先手绘空间的外轮廓。');
  const vertices=outlineFromStroke(stroke.points);
  const space=addSpace(w,plan,{type:'add_polygon',vertices},null);
  plan.spaces.push(space);
  plan.strokes=plan.strokes.filter(s=>s.id!==stroke.id);
  created.push(space.id);changedIds.push(space.id);
  messages.push('手绘轮廓已建为空间，面积 '+round(areaOf(space))+'㎡');
}
else if(t==='move_stroke'||t==='delete_stroke'){
  const stroke=plan.strokes?.find(s=>s.id===action.targetId);
  if(!stroke)throw Error('这条手绘线已经改变，请重新选择。');
  if(t==='delete_stroke'){
    plan.strokes=plan.strokes.filter(s=>s.id!==stroke.id);
    messages.push('删除了选中的手绘线');
  }else{
    const dx=value(action.dx,-1000,1000),dy=value(action.dy,-1000,1000);
    const points=stroke.points.map(([x,y])=>[round(x+dx),round(y+dy)]);
    if(points.some(([x,y])=>x<0||y<0||x>plan.width||y>plan.depth))throw Error('手绘线超出了画布，请调整位置。');
    stroke.points=points;
    messages.push('移动了选中的手绘线');
  }
}
else if(t==='add_space'||t==='duplicate_space'||t==='add_polygon'){
  const s=addSpace(w,plan,action,t==='duplicate_space'?resolve():null);
  plan.spaces.push(s);
  created.push(s.id);
  changedIds.push(s.id);
  messages.push('添加了'+(s.label||w.program.find(p=>p.id===s.programId).name)+'（'+round(areaOf(s))+'㎡）');
}
else if(t==='update_space'||t==='move_vertex'){
  const s=resolve();
  if(t==='move_vertex'){
    const index=action.vertexIndex;
    if(!isPolygon(s)||!Number.isInteger(index)||index<0||index>=s.geometry.vertices.length)throw Error('请选择要移动的多边形顶点。');
    const vertices=s.geometry.vertices.map((point,i)=>i===index?action.point:point);
    s.geometry.vertices=validateVertices(vertices);
  }else updateSpace(s,action);
  changedIds.push(s.id);
  const label=s.label||w.program.find(p=>p.id===s.programId)?.name||'空间';
  messages.push('更新了'+label+'，'+(action.height!=null?'高度 '+s.height+' m，':'')+'面积 '+round(areaOf(s))+'㎡');
}
else if(t==='delete_space'){const s=resolve();o.plan.spaces=o.plan.spaces.filter(x=>x.id!==s.id);changedIds.push(s.id);messages.push('移除了选中的空间');}
else if(t==='duplicate_option'){if(w.options.length>=12)throw Error('最多保留12个备选方案。');const clone=copyOption(o,action.name?.trim()?name(action.name,100):(o.title+' · 副本').slice(0,100));w.options.push(clone);o=clone;optionId=clone.id;messages.push('创建了独立副本“'+clone.title+'”');}
else if(t==='rename_project'){next.name=name(action.name,100);messages.push('项目已命名为“'+next.name+'”');}
else if(t==='set_brief'){const text=typeof action.notes==='string'?action.notes.trim():'';if(!text||text.length>2000)throw Error('请用简短文字描述设计想法。');w.brief.questions=(w.brief.questions?w.brief.questions+'\n':'')+text;if(w.brief.questions.length>6000)throw Error('任务记录较长，请先整理。');messages.push('已记录本轮设计想法');}
for(const option of w.options){option.plan=validatePlan(option.plan||emptyPlan(),w.program);if(bounded)for(const s of option.plan.spaces.filter(s=>changedIds.includes(s.id)))if(outsidePlan(s,option.plan))throw Error('这次修改超出了画布，请调整尺寸或位置。')}}
if(actions.length){w.active=4;w.stages[3].status='working'}return {project:next,summary:messages.join('；')||'设计保持原样。',optionId,createdIds:created,changedIds}}
export function captureDraft(p){const w=p.workflow||emptyWorkflow(p);return structuredClone({name:p.name,program:w.program.map(r=>({...r,origin:r.origin||'brief'})),options:w.options.map(o=>({...o,plan:{...o.plan||emptyPlan(),spaces:(o.plan?.spaces||[]).map(s=>({...s,label:s.label||''}))}})),selectedOptionId:w.selectedOptionId,choiceReason:w.choiceReason,relationships:w.relationships||[],board:w.board||[],brief:w.brief})}
export function restoreDraft(p,snapshot){const next={...p,workflow:structuredClone(p.workflow||emptyWorkflow(p))};next.name=snapshot.name;for(const key of ['program','options','selectedOptionId','choiceReason','relationships','board','brief'])next.workflow[key]=structuredClone(snapshot[key]);next.workflow.stages[3].status='working';return next}
export function draftKey(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)}
export class DraftHistory{constructor(){this.undoStack=[];this.redoStack=[]}record(before,after,label='设计修改'){if(draftKey(before)===draftKey(after))return;this.undoStack.push({before,after,label});this.undoStack=this.undoStack.slice(-25);this.redoStack=[]}step(p,redo=false){const source=redo?this.redoStack:this.undoStack,target=redo?this.undoStack:this.redoStack,entry=source.at(-1);if(!entry)return null;const expected=redo?entry.before:entry.after;if(draftKey(captureDraft(p))!==draftKey(expected)){this.undoStack=[];this.redoStack=[];throw Error('设计已在其他入口变化，撤销历史已更新；当前内容保持原样。')}source.pop();target.push(entry);return {project:restoreDraft(p,redo?entry.after:entry.before),label:entry.label}}}
export function localStudioIntent(message,p,selection={}){const text=message.trim(),facts=assistantFacts(p,selection),selected=facts.plan.spaces.find(s=>s.id===selection.spaceIds?.[0]);const a=(type,rest={})=>({type,...rest});if(/^(撤销|退回上一步|undo)$/i.test(text))return {command:'undo'};if(/^(重做|redo)$/i.test(text))return {command:'redo'};if(/^(检查|检查重叠|检查面积|面积是多少|查看面积|有哪些冲突)[？?。！!]*$/.test(text))return {command:'metrics'};if(/^(复制|另存).*(方案|版本)|^(再试一个方案|复制当前方案)$/.test(text))return {actions:[a('duplicate_option')]};if(/^(删除|移除)(它|这个|选中.*|当前.*|空间)?[。！!]*$/.test(text))return selected?{actions:[a('delete_space',{targetId:selected.id})]}:{clarify:'请在画布上点选要移除的空间。'};
const areaMatch=text.match(/^(?:请)?(?:把)?(?:选中的?(?:空间)?|这个空间|它)?(?:的面积)?(?:改为|改成|调整为|设为|放大到|缩小到)\s*(\d+(?:\.\d+)?)\s*(?:㎡|m²|平方米|平米)[。！!]*$/i);if(areaMatch)return selected?{actions:[a('update_space',{targetId:selected.id,area:Number(areaMatch[1])})]}:{clarify:'请先点选要调整面积的空间。'};const percentage=text.match(/^(?:请)?(?:把)?(?:选中的?(?:空间)?|这个空间|它)?(放大|扩大|缩小)\s*(\d+(?:\.\d+)?)\s*%[。！!]*$/);if(percentage)return selected?{actions:[a('update_space',{targetId:selected.id,scale:1+(percentage[1]==='缩小'?-1:1)*Number(percentage[2])/100})]}:{clarify:'先在画布上选中空间，我再调整大小。'};
const add=text.match(/^(?:请)?(?:帮我)?(?:添加|增加|加)(?:一?个)?\s*(?:(\d+(?:\.\d+)?)\s*(?:㎡|m²|平方米|平米)(?:的)?)?\s*([^，。！？]{1,30})[。！!]*$/i);if(add&&!/(方案|项目|建筑|全部|然后|并且|再把|删除|不要|为什么)/.test(add[2]))return {actions:[a('add_space',{name:add[2].trim(),area:add[1]?Number(add[1]):20})]};return null}
