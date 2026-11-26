import {modelSnapshot} from './models.js';
import {RoomError,sharedRevision,valid,versionSummaries,storeSharedRevision} from './concept-revisions.js';

function pdfText(item){
  if(!Array.isArray(item.pdfPages))return {extractedText:typeof item.extractedText==='string'?item.extractedText.slice(0,12000):''};
  const {pdfPages,pdfPageCount,pdfTruncated}=item;
  const pages=new Set();
  if(!Number.isInteger(pdfPageCount)||pdfPageCount<1||pdfPages.length>10||pdfPages.some(row=>{
    if(!Number.isInteger(row?.page)||row.page<1||row.page>Math.min(10,pdfPageCount)||pages.has(row.page)||typeof row.text!=='string')return true;
    pages.add(row.page);
    return false;
  }))throw new RoomError('PDF 提取页记录无效。');
  if(pdfPages.reduce((sum,row)=>sum+row.text.length,0)>12000)throw new RoomError('PDF 提取文字超过 12000 字符。');
  return {pdfPages:pdfPages.map(({page,text})=>({page,text})),pdfPageCount,pdfTruncated:pdfTruncated===true||pdfPageCount>10};
}

async function submittedFiles(bucket,prefix,items,parent=[]){
  if(!Array.isArray(items)||!items.length||items.length>3)throw new RoomError('请选择一至三份作品材料。');
  const ids=new Set(),files=[];
  for(const item of items){
    if(!valid(item?.id)||ids.has(item.id))throw new RoomError('作品材料无效。');
    ids.add(item.id);
    const previous=parent.find(file=>file.id===item.id);
    const source=await bucket.head(prefix+'files/'+item.id);
    const meta=source?.customMetadata;
    if(meta?.purpose!=='final'||meta.project!=='final-upload'||meta.parentId||!['jpg','png','pdf','skp'].includes(meta.type)){
      throw new RoomError('材料不属于本次可提交的作品。');
    }
    if(Number.isFinite(source.size)&&source.size>20*1024*1024)throw new RoomError('每份原件最多 20 MB。');
    const details=previous||item;
    const previewId=details.previewId;
    if(previewId){
      const cover=valid(previewId)&&await bucket.head(prefix+'files/'+previewId);
      const info=cover?.customMetadata;
      if(meta.type!=='pdf'||info?.purpose!=='final'||info.parentId!==item.id||info.type!=='jpg'||info.page!=='1'){
        throw new RoomError('预览页与原文件不符。');
      }
    }
    const conversion=meta.type==='skp'?(previous?.conversion?.status==='ready'?previous.conversion:await modelSnapshot(bucket,prefix,item.id)):null;
    files.push({id:item.id,type:meta.type,name:decodeURIComponent(meta.name),
      ...(meta.type==='pdf'?pdfText(details):{}),...(previewId?{previewId}:{}),...(conversion?{conversion}:{})});
  }
  return files;
}

export async function createFinalSubmission(bucket,prefix,data,state){
  const title=typeof data.title==='string'&&data.title.trim(),focus=data.focus??'';
  if(!title||title.length>100||typeof focus!=='string'||focus.length>3000)throw new RoomError('请填写作品名称，关注问题最多 3000 字。');
  const course={name:'作品评阅',brief:'',focus:''};
  let files=[],drawing;
  if(data.versionId){
    const version=state?.projects.find(p=>p.id===data.projectId&&!p.trashedAt)?.versions.find(v=>v.id===data.versionId);
    const option=version?.snapshot.workflow?.options.find(o=>o.id===data.optionId);
    if(!option?.plan)throw new RoomError('请选择已保存版本中的一个平面方案。');
    const {underlay,...geometry}=option.plan;
    drawing={title:option.title,plan:geometry,program:(version.snapshot.workflow.program||[]).map(({id,name})=>({id,name}))};
  }else files=await submittedFiles(bucket,prefix,data.files);
  const id=crypto.randomUUID(),createdAt=new Date().toISOString();
  const snapshot={id,name:title,description:focus,goal:'',users:'',report:focus,reason:'',evidence:'',reflection:'',files,feedback:[],questions:[]};
  if(drawing)snapshot.drawing=drawing;
  return {id,title,kind:'final',course,createdAt,version:{id:crypto.randomUUID(),number:1,label:'提交作品',createdAt,snapshot}};
}

export const finalLatest=room=>room.sharedVersions?.at(-1)?.id||room.version.id;
export const finalEntryVersion=(room,entry)=>entry.versionId||room.version.id;
export const finalConversion=(room,versionId,file)=>room.versionModels?.[versionId]?.[file.id]||
  (versionId===room.version.id?room.modelResults?.[file.id]:undefined)||file.conversion;

export async function finalVersion(bucket,room,versionId=room.version.id){
  const version=await sharedRevision(bucket,room,versionId);
  return {...version,snapshot:{...version.snapshot,files:version.snapshot.files.map(file=>{
    const conversion=finalConversion(room,version.id,file);
    return conversion?{...file,conversion}:file;
  })}};
}

export async function addFinalVersion(bucket,room,data,id){
  if(data.parentVersionId!==finalLatest(room))throw new RoomError('已有更新的提交，请从最新版本重新选择材料。',409);
  if((room.sharedVersions||[]).length>=30)throw new RoomError('已达到 30 次修订上限，请发起新一轮终评。');
  const note=typeof data.note==='string'&&data.note.trim();
  if(!note||note.length>3000)throw new RoomError('请填写 3000 字以内的修订说明。');
  const parent=await finalVersion(bucket,room,data.parentVersionId);
  const focus=data.focus??parent.snapshot.description;
  if(typeof focus!=='string'||focus.length>3000)throw new RoomError('设计说明最多 3000 字。');
  const keepDrawing=data.keepDrawing===true;
  if(keepDrawing&&(!parent.snapshot.drawing||data.files?.length))throw new RoomError('请选择沿用平面方案或提交文件。');
  const files=keepDrawing?[]:await submittedFiles(bucket,room.ownerPrefix,data.files,parent.snapshot.files);
  const {drawing,...snapshot}=parent.snapshot;
  await storeSharedRevision(bucket,room,{id,number:parent.number+1,parentVersionId:parent.id,label:'修订提交',note,
    createdAt:new Date().toISOString(),createdBy:'学生',snapshot:{...snapshot,description:focus,report:focus,files,...(keepDrawing?{drawing}:{})}});
}

export function finalVerdictHistory(room,versionId){
  const rows=room.verdicts?.length?room.verdicts:room.verdict?[room.verdict]:[];
  return rows.filter(row=>finalEntryVersion(room,row)===versionId);
}

export function finalVerdicts(room,versionId){
  const latest=new Map();
  for(const {authorId,...row} of finalVerdictHistory(room,versionId)){
    const key=authorId||row.author;
    latest.delete(key);
    latest.set(key,row);
  }
  return [...latest.values()];
}

export const finalReviewIndex=(prefix,roomId,versionId)=>prefix+'ai/final-index/'+roomId+'/'+versionId+'.json';

export function reviewImageBytes(data,limit=850000){
  const match=typeof data==='string'&&data.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||match[2].length>limit)throw new RoomError('点评图片格式无效或过大。');
  let bytes;
  try{bytes=Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0))}catch{throw new RoomError('点评图片编码无效。')}
  const jpeg=match[1]==='jpeg';
  if(jpeg?bytes[0]!==255||bytes[1]!==216:bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71){
    throw new RoomError('点评图片内容与格式不符。');
  }
  return {bytes,type:'image/'+match[1]};
}

// Return only published evidence references. Full provider input stays in the owner's run record.
export async function finalAiResult(bucket,room,versionId=room.version.id){
  const versionIndex=await bucket.get(finalReviewIndex(room.ownerPrefix,room.id,versionId));
  const legacy=versionId===room.version.id&&await bucket.get(room.ownerPrefix+'ai/index/final-'+room.id+'.json');
  const entries=[...(versionIndex?await versionIndex.json():[]),...(legacy?await legacy.json():[])];
  for(const entry of entries){
    const raw=await bucket.get(room.ownerPrefix+'ai/runs/'+entry.id+'.json');
    const run=raw&&await raw.json();
    if(run?.finalRoomId!==room.id||(run.submissionVersionId||room.version.id)!==versionId||run.status!=='succeeded')continue;
    return {id:run.id,submissionVersionId:versionId,provider:run.provider,model:run.model,createdAt:run.createdAt,
      summary:run.output.summary,strengths:run.output.strengths,missingMaterials:run.output.missingMaterials,
      teacherQuestions:run.output.teacherQuestions,coverage:run.coverage||[],comments:run.output.comments.map(c=>{
        const source=run.sources.find(s=>s.id===c.sourceId),modelView=run.views?.find(v=>v.id===c.sourceId);
        return {...c,location:source?.label||'',fileId:source?.fileId||null,page:source?.page||source?.derivedFrom?.page||null,
          ...(modelView?{modelViewId:modelView.id,resultId:modelView.resultId,camera:modelView.camera}:{})};
      })};
  }
  return null;
}
