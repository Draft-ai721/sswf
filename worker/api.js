import {PLAN_LINEAGE_HEADER} from '../shared/space-planning.js';
import {REQUIREMENT_HEADER} from '../shared/program-requirements.js';
import {validateWorkflow} from './workflow-validation.js';
import {isPolygon, PLAN_GEOMETRY_HEADER, PLAN_GEOMETRY_VERSION, PLAN_VIEW_HEADER} from '../shared/plan-geometry.js';
import {reviewRoomsApi} from './review-rooms.js';
import {aiApi} from './ai.js';
import {aiStatus} from './ai-connection.js';
import {uploadMaterial} from './upload.js';
import {modelsApi,modelSnapshot} from './models.js';
const MAX_FILE=20*1024*1024;const MAX_STATE=4*1024*1024;
const json=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(error,status=400)=>json({error},status);
export const workspaceReadOnly=env=>env.STUDIO_READ_ONLY==='1';
export function pauseWorkspaceWrites(request,env){
 if(workspaceReadOnly(env)&&['POST','PUT','DELETE','PATCH'].includes(request.method)){
   return json({code:'workspace_read_only',error:'工作坊暂时只读，请保留本机修改，开放写入后再保存。'},503,{'Retry-After':'60'});
 }
 return null;
}
const hasRequirements=state=>state?.projects.some(p=>Array.isArray(p.workflow?.program)&&p.workflow.program.some(row=>row?.spec!==undefined));
const hasLineage=state=>state?.projects.some(p=>p.workflow?.compareWithId||(Array.isArray(p.workflow?.options)&&
 p.workflow.options.some(o=>Array.isArray(o?.plan?.spaces)&&o.plan.spaces.some(s=>s?.sourceSpaceId!==undefined))));
const hasViewpoints=state=>state?.projects.some(p=>p.workflow?.options?.some(o=>o.viewpoints?.length));
const hasUnderlay=state=>state?.projects.some(p=>p.workflow?.options?.some(o=>o.plan?.underlay));
const hasSketches=state=>state?.projects.some(project=>project.workflow?.options?.some(o=>o.plan?.strokes?.length));
const workflowHasPolygons=workflow=>workflow?.options?.some(option=>option.plan?.spaces?.some(isPolygon));
// An older page can fetch a current ETag while still serializing only rectangles.
const containsPolygons=state=>state?.projects.some(project=>workflowHasPolygons(project.workflow)||
 project.versions?.some(version=>workflowHasPolygons(version.snapshot?.workflow)));
const stateConflict=()=>json({code:'state_conflict',error:'其他页面已保存修改。请先下载未保存草稿，再刷新并重新应用需要的修改。'},409);
const geometryConflict=()=>json({code:'geometry_version',error:'当前页面版本过旧，无法保存此方案。请先保留未保存的内容，再刷新页面。'},409);
const safeId=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(s);
async function limitedBody(request,max){const length=Number(request.headers.get('Content-Length'));if(length>max)throw Error('请求内容超过容量限制');if(!request.body)return new Uint8Array();const reader=request.body.getReader();const chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('请求内容超过容量限制')}chunks.push(value)}const result=new Uint8Array(size);let pos=0;for(const c of chunks){result.set(c,pos);pos+=c.length}return result;}
async function readJson(request,max=MAX_STATE){return JSON.parse(new TextDecoder().decode(await limitedBody(request,max)))}
function validateState(s){if(!s||s.schema!==1||!Array.isArray(s.projects)||s.projects.length>100||!s.course)return false;return s.projects.every(p=>safeId(p.id)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=100&&typeof p.report==='string'&&p.report.length<=200000&&Number.isInteger(p.stage)&&p.stage>=0&&p.stage<=6&&['files','feedback','questions','annotations','versions'].every(k=>Array.isArray(p[k]))&&p.files.every(f=>safeId(f.id)&&(f.extractedText===undefined||typeof f.extractedText==='string'&&f.extractedText.length<=12000)))}
async function current(bucket,key){const obj=await bucket.get(key);return obj?{state:await obj.json(),etag:obj.etag}:{state:null,etag:null};}
function precondition(request,old){const expected=request.headers.get('If-Match');return old.etag?expected===old.etag:request.headers.get('If-None-Match')==='*';}
async function put(bucket,key,state,old){return bucket.put(key,JSON.stringify(state),{httpMetadata:{contentType:'application/json'},onlyIf:old.etag?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}})}
export async function api(request,env){const url=new URL(request.url);if(url.pathname==='/api/ai/status'&&request.method==='GET')return aiStatus(request,env);const user=request.headers.get('oai-authenticated-user-id');if(!user)return fail('请登录后使用你的私人工作空间。',401);if(!env.BUCKET)return fail('云端存储尚未就绪，请稍后重试。',503);const prefix='users/'+encodeURIComponent(user)+'/';const key=prefix+'state.json';const bucket=env.BUCKET;
 if(['POST','PUT','DELETE','PATCH'].includes(request.method)){const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return fail('不允许跨站修改。',403)}
 const paused=pauseWorkspaceWrites(request,env);if(paused)return paused;
 try{
 const roomResponse=await reviewRoomsApi(request,env,prefix,{readJson});if(roomResponse)return roomResponse;
 const aiResponse=await aiApi(request,env,prefix,{readJson,limitedBody});if(aiResponse)return aiResponse;
 const modelResponse=await modelsApi(request,bucket,prefix,limitedBody,readJson);if(modelResponse)return modelResponse;
 if(url.pathname==='/api/state'&&request.method==='GET'){return json({...await current(bucket,key),draftAccount:user,...(workspaceReadOnly(env)?{workWrites:false}:{})})}
 if(url.pathname==='/api/state'&&request.method==='PUT'){const s=await readJson(request);if(!validateState(s))return fail('项目数据格式不正确。');const old=await current(bucket,key);if(!precondition(request,old))return stateConflict();if(request.headers.get('X-Plan-Underlay')!=='1'&&(hasUnderlay(old.state)||hasUnderlay(s)))return geometryConflict();if(request.headers.get(PLAN_VIEW_HEADER)!=='1'&&(hasViewpoints(old.state)||hasViewpoints(s)))return geometryConflict();if(request.headers.get(REQUIREMENT_HEADER)!=='1'&&(hasRequirements(old.state)||hasRequirements(s)))return geometryConflict();if(request.headers.get(PLAN_LINEAGE_HEADER)!=='1'&&(hasLineage(old.state)||hasLineage(s)))return geometryConflict();const version=request.headers.get(PLAN_GEOMETRY_HEADER),sketchReady=version===PLAN_GEOMETRY_VERSION,geometryReady=sketchReady||version==='2';if((!sketchReady&&hasSketches(old.state))||(!geometryReady&&containsPolygons(old.state)))return geometryConflict();for(const p of s.projects){const previous=old.state?.projects.find(x=>x.id===p.id);try{const workflow=validateWorkflow(p.workflow,previous?.workflow,p);if(workflow){
 const sources=new Set(workflow.program.map(row=>row.spec?.source?.fileId).filter(Boolean));
 for(const id of sources){
   const object=await bucket.head(prefix+'files/'+id);
   if(object?.customMetadata?.project!==p.id||object.customMetadata?.type!==p.files.find(f=>f.id===id)?.type)throw Error('需求引用的原件不属于此项目。');
 }
 p.workflow=workflow;
 }}catch(e){return fail(e.message)}p.versions=previous?.versions||[];p.aiRunIds=previous?.aiRunIds||[];delete p.aiAssistantReceipts;if(previous?.aiAssistantReceipts)p.aiAssistantReceipts=previous.aiAssistantReceipts;p.aiDraft=previous?.aiDraft||null;const aiRecords=(previous?.feedback||[]).filter(f=>f.sourceKind==='ai');p.feedback=[...p.feedback.filter(f=>f.sourceKind!=='ai'&&!aiRecords.some(a=>a.id===f.id)),...aiRecords.map(a=>{const edited=p.feedback.find(f=>f.id===a.id);return {...a,...(edited?{response:edited.response,history:edited.history,status:['待回应','已回应','待复核','已解决'].includes(edited.status)?edited.status:a.status}:{})}})];}if((!sketchReady&&hasSketches(s))||(!geometryReady&&containsPolygons(s)))return geometryConflict();s.updatedAt=new Date().toISOString();const stored=await put(bucket,key,s,old);if(!stored)return stateConflict();return json({etag:stored.etag,updatedAt:s.updatedAt})}
 if(url.pathname==='/api/snapshots'&&request.method==='POST'){const data=await readJson(request,16000);const old=await current(bucket,key);if(!precondition(request,old))return fail('版本冲突，请保存最新内容后重新提交。',409);const p=old.state?.projects.find(p=>p.id===data.projectId);if(!p)return fail('项目不存在。',404);if(!['stage','defense'].includes(data.kind)||typeof data.label!=='string'||!data.label.trim()||typeof data.note!=='string'||!data.note.trim())return fail('请填写版本标题与修改说明。');if(data.label.length>100||data.note.length>10000)return fail('版本说明过长。');if(data.kind==='defense'&&!p.report.trim())return fail('提交前请填写个人汇报稿。');const snapshot=structuredClone(p);delete snapshot.versions;for(const f of snapshot.files){if(f.type==='skp')f.conversion=await modelSnapshot(bucket,prefix,f.id)}const version={id:crypto.randomUUID(),number:p.versions.length+1,label:data.label,kind:data.kind,note:data.note,createdAt:new Date().toISOString(),snapshot};p.versions.push(version);if(data.kind==='defense')p.stage=5;const body=JSON.stringify(old.state);if(new TextEncoder().encode(body).length>MAX_STATE)return fail('项目档案已达到当前容量限制，请先导出记录。',413);const stored=await put(bucket,key,old.state,old);if(!stored)return fail('保存遇到版本冲突，请刷新后重试。',409);return json({state:old.state,etag:stored.etag,versionId:version.id})}
 if(['/api/files','/api/final-files'].includes(url.pathname)&&request.method==='POST')return await uploadMaterial(request,url,bucket,prefix,{readState:()=>current(bucket,key),limitedBody,maxFile:MAX_FILE,json,fail});
 const fileMatch=url.pathname.match(/^\/api\/files\/([a-zA-Z0-9-]{1,80})$/);if(fileMatch&&request.method==='GET'){const obj=await bucket.get(prefix+'files/'+fileMatch[1]);if(!obj)return fail('文件不存在，或你无权访问。',404);const metadata=obj.customMetadata||{};const name=metadata.name||'download';const inline=url.searchParams.get('preview')==='1'&&metadata.type!=='skp';return new Response(obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename="download.${metadata.type||'bin'}"; filename*=UTF-8''${name}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}})}

 return fail('接口不存在。',404);
 }catch(e){console.error('Request failed',e.name,e.message);if(e instanceof SyntaxError)return fail('请求数据格式不正确。');if(e.message.includes('容量限制'))return fail(e.message,413);return fail('保存暂未完成，请稍后重试。',500)}
}
