import {validateGlb,MAX_GLB_BYTES} from '../shared/glb.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const error=(message,status=400)=>json({error:message},status);
const active=new Set(['queued','parsing','building','exporting','saving']);
const now=()=>new Date().toISOString();
async function record(bucket,key){const r=await bucket.get(key);return r?{value:await r.json(),etag:r.etag}:null}
async function change(bucket,key,old,value){return bucket.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'},onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}})}
const expired=m=>active.has(m.status)&&Date.now()>Date.parse(m.expiresAt||0);
const publicState=m=>{const r={...m};if(expired(r)){r.status='interrupted';r.error='上次转换已中断或超时，原文件仍保留，可以重试。'}return r};
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')}
export async function initializeModel(bucket,prefix,id,bytes){const value={fileId:id,status:'uploaded',sourceSha256:await digest(bytes),updatedAt:now(),engine:'OpenSKP 1.5.0',resultId:null};await bucket.put(prefix+'models/'+id+'/status.json',JSON.stringify(value));return value;}
export async function modelSnapshot(bucket,prefix,id){const m=await record(bucket,prefix+'models/'+id+'/status.json');return m?publicState(m.value):{fileId:id,status:'uploaded',resultId:null}}
export async function modelsApi(request,bucket,prefix,limitedBody,readJson){const url=new URL(request.url);const match=url.pathname.match(/^\/api\/models\/([a-zA-Z0-9-]{1,80})(?:\/(retry|progress|complete|cancel|results)(?:\/([a-zA-Z0-9-]{1,80}))?)?$/);if(!match)return null;const [,id,action,resultId]=match;const base=prefix+'models/'+id+'/';const source=await bucket.head(prefix+'files/'+id);if(!source||source.customMetadata?.type!=='skp')return error('SKP 原文件不存在，或你无权访问。',404);let old=await record(bucket,base+'status.json');
if(!action&&request.method==='GET')return json({model:old?publicState(old.value):{fileId:id,status:'uploaded',resultId:null}});
if(action==='results'&&resultId&&request.method==='GET'){const meta=await record(bucket,base+'results/'+resultId+'.json');if(!meta)return error('转换结果不存在。',404);const file=await bucket.get(base+'results/'+resultId+'.glb');if(!file)return error('转换文件暂不可用。',404);return new Response(file.body,{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="model-${id}.glb"`}})}
if(action==='retry'&&request.method==='POST'){
 if(old?.value.status==='ready')return json({model:old.value});if(old&&active.has(old.value.status)&&!expired(old.value))return error('已有转换正在进行。若上次页面已关闭，请先取消再重试。',409);
 let hash=old?.value.sourceSha256;if(!hash){const raw=await bucket.get(prefix+'files/'+id);hash=await digest(await new Response(raw.body).arrayBuffer())}
 const value={fileId:id,jobId:crypto.randomUUID(),status:'queued',resultId:null,sourceSha256:hash,startedAt:now(),updatedAt:now(),expiresAt:new Date(Date.now()+180000).toISOString(),engine:'OpenSKP 1.5.0'};if(!await change(bucket,base+'status.json',old,value))return error('另一处页面已启动转换，请刷新状态。',409);return json({model:value},202);
}
if(['progress','cancel','complete'].includes(action)&&['POST','PUT'].includes(request.method)){
 const job=request.headers.get('X-Conversion-Id');if(!old||!job||old.value.jobId!==job)return error('转换任务已被替换，请重新读取状态。',409);
 if(action==='complete'&&old.value.status==='ready')return json({model:old.value});
 if(!active.has(old.value.status)||expired(old.value))return error('转换任务已结束或超时，请重试。',409);
 if(action==='cancel'){const value={...old.value,status:'cancelled',updatedAt:now(),error:'转换已取消，原文件仍保留。'};if(!await change(bucket,base+'status.json',old,value))return error('任务状态已改变。',409);return json({model:value})}
 if(action==='progress'){const data=await readJson(request,4000);if(!['parsing','building','exporting','saving','failed'].includes(data.status))return error('无效的转换阶段。');const value={...old.value,status:data.status,updatedAt:now()};if(data.status==='failed')value.error=String(data.error||'转换失败，请检查文件。').slice(0,600);if(Number.isInteger(data.current)&&Number.isInteger(data.total)&&data.current>=0&&data.total>0&&data.current<=data.total)value.progress={current:data.current,total:data.total};if(!await change(bucket,base+'status.json',old,value))return error('任务状态已改变。',409);return json({model:value})}
 if(action==='complete'){
  if(request.headers.get('X-Source-SHA256')!==old.value.sourceSha256)return error('转换结果与当前原文件不一致。',409);
  const bytes=await limitedBody(request,MAX_GLB_BYTES);let metadata;try{metadata=validateGlb(bytes)}catch(e){return error(e.message,422)}
  await bucket.put(base+'results/'+job+'.glb',bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'model/gltf-binary'}});
  const value={...old.value,status:'ready',resultId:job,updatedAt:now(),completedAt:now(),metadata,viewerUrl:'/api/models/'+id+'/results/'+job};delete value.error;delete value.progress;
  await bucket.put(base+'results/'+job+'.json',JSON.stringify(value),{onlyIf:{etagDoesNotMatch:'*'}});
  // Refresh the state because a final progress heartbeat may have arrived during upload.
  old=await record(bucket,base+'status.json');if(old.value.jobId!==job||!active.has(old.value.status))return error('任务在上传期间已取消或改变，旧任务不能覆盖新结果。',409);
  if(!await change(bucket,base+'status.json',old,value))return error('状态写入发生冲突，请刷新后重试。',409);return json({model:value});
 }
}
return error('不支持的模型操作。',405);
}
