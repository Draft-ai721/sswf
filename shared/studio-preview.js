import {applyStudioActions,copyOption,draftKey} from './studio-actions.js';
import {areaOf,round,planMetrics} from './space-planning.js';

const lineage=space=>space.sourceSpaceId||space.id;
export function compareSpaces(left,right) {
  const rightBySource=new Map(right.spaces.map(space=>[lineage(space),space]));
  const matched=new Set();
  const pairs=left.spaces.map(before=>{
    const after=rightBySource.get(lineage(before));
    if(after)matched.add(after.id);
    return {before,after};
  });
  return pairs.concat(right.spaces.filter(space=>!matched.has(space.id)).map(after=>({after})));
}

const spaceName=(space,program)=>space?.label||program.find(row=>row.id===space?.programId)?.name||'空间';
function editableValues(space) {
  if(!space)return null;
  const {id,sourceSpaceId,...content}=space;
  return content;
}

export function previewStudioActions(project,actions,selection,mode,allocateId) {
  if(!['current','copy'].includes(mode)||!Array.isArray(actions)||!actions.length||actions.length>10)throw Error('预览请求无效。');
  const original=project.workflow?.options.find(option=>option.id===selection.optionId);
  if(!original||selection.spaceIds?.some(id=>!original.plan.spaces.some(space=>space.id===id))){
    throw Error('原方案或选中空间已经变化。');
  }
  const copies=actions.filter(action=>action.type==='duplicate_option');
  if(copies.length>1)throw Error('请一次只预览一个方案副本。');
  const copied=mode==='copy'||copies.length===1;
  if(copied&&actions.some(action=>['rename_project','set_brief'].includes(action.type))){
    throw Error('项目名称或任务记录属于整个项目，请在当前方案预览。');
  }
  let draft=project, target=selection, commands=actions;
  if(copied){
    if(project.workflow.options.length>=12)throw Error('最多保留12个备选方案。');
    draft=structuredClone(project);
    const title=(copies[0]?.name?.trim()||original.title+' · 副本').slice(0,100);
    const copy=copyOption(original,title,allocateId);
    const remap=new Map(original.plan.spaces.map((space,i)=>[space.id,copy.plan.spaces[i].id]));
    draft.workflow.options.push(copy);
    target={optionId:copy.id,spaceIds:(selection.spaceIds||[]).map(id=>remap.get(id))};
    commands=actions.filter(action=>action.type!=='duplicate_option')
      .map(action=>action.targetId?{...action,targetId:remap.get(action.targetId)||action.targetId}:action);
  }
  const result=applyStudioActions(draft,commands,target,{allocateId});
  const before=original.plan, w=result.project.workflow;
  const option=w.options.find(option=>option.id===result.optionId);
  const after=option.plan, prior=project.workflow;
  const changes=compareSpaces(before,after).filter(({before,after})=>draftKey(editableValues(before))!==draftKey(editableValues(after)))
    .map(({before,after})=>({before,after,kind:!before?'added':!after?'removed':'updated',
      name:after?spaceName(after,w.program):spaceName(before,prior.program),
      beforeArea:before?round(areaOf(before)):null,afterArea:after?round(areaOf(after)):null}));
  const output={copied,sourceOptionId:original.id,optionId:option.id,optionTitle:option.title,changes,
    beforeMetrics:planMetrics(before,prior.program,prior.relationships),
    afterMetrics:planMetrics(after,w.program,w.relationships),createdIds:result.createdIds,changedIds:result.changedIds,
    summary:copied?'创建了方案“'+option.title+'”'+(commands.length?'。'+result.summary:''):result.summary};
  return {project:result.project,preview:output};
}
