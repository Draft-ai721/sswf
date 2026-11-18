export const MODEL_STATUS={uploaded:'原文件已保存',queued:'等待转换',downloading:'读取原文件',parsing:'解析 SKP',building:'生成组件与网格',exporting:'生成网页模型',saving:'保存转换结果',ready:'转换完成',failed:'转换失败',cancelled:'已取消',interrupted:'转换中断',blocked_configuration:'等待转换'};
export function createConversions({api,update,onReady}){
 const states=new Map(),tasks=new Map();
 const put=(id,value)=>{states.set(id,value);update(id,value)};
 async function inspect(id,force=false){const guard=tasks.get(id);if(guard&&!force)return states.get(id);try{const r=await api('/api/models/'+id);if(tasks.get(id)!==guard)return states.get(id);put(id,r.model);return r.model}catch(e){if(tasks.get(id)===guard)put(id,{fileId:id,status:'unavailable',error:e.message});return null}}
 async function start(file){
  if(tasks.has(file.id))return;
  const task={id:file.id,cancelled:false,cancelling:false,worker:null,progressQueue:Promise.resolve(),lastSent:0,controller:new AbortController()};tasks.set(file.id,task);
  const owns=()=>tasks.get(file.id)===task&&!task.cancelled;
  const cleanup=()=>{clearTimeout(task.timer);task.worker?.terminate();if(tasks.get(file.id)===task&&!task.cancelling)tasks.delete(file.id)};
  try{
   const model=(await api('/api/models/'+file.id+'/retry',{method:'POST'})).model;
   if(!owns())return;put(file.id,model);if(model.status==='ready'){onReady(file.id,model);return}task.jobId=model.jobId;
   const progress=(status,counts={},force=false)=>{
    if(!owns())return;put(file.id,{...states.get(file.id),status,progress:counts.total?counts:undefined});
    if(force||Date.now()-task.lastSent>1500){task.lastSent=Date.now();task.progressQueue=task.progressQueue.catch(()=>{}).then(()=>owns()?api('/api/models/'+file.id+'/progress',{method:'POST',headers:{'X-Conversion-Id':task.jobId},body:JSON.stringify({status,...counts})}):null);task.progressQueue.catch(()=>{})}
   };
   put(file.id,{...model,status:'downloading'});const response=await fetch('/api/files/'+file.id,{signal:task.controller.signal});if(!owns())return;if(!response.ok)throw Error('读取原文件失败，请检查网络后重试。');const buffer=await response.arrayBuffer();if(!owns())return;
   const result=await new Promise((resolve,reject)=>{
    const worker=new Worker('/skp-worker.js',{type:'module'});task.worker=worker;task.reject=reject;
    task.timer=setTimeout(()=>{worker.terminate();reject(Error('转换超过 120 秒，已停止处理。请精简模型后重试。'))},120000);
    worker.onerror=()=>reject(Error('转换进程异常，可能超过浏览器内存限制。原文件已保留。'));
    worker.onmessage=({data})=>{if(!owns())return;if(data.type==='progress')progress(data.stage,{current:data.current,total:data.total});else if(data.type==='error')reject(Error(data.message));else if(data.type==='complete')resolve(data)};
    worker.postMessage({buffer},[buffer]);
   });
   clearTimeout(task.timer);task.worker?.terminate();task.worker=null;if(!owns())return;
   progress('saving',{},true);await task.progressQueue;if(!owns())return;
   const r=await api('/api/models/'+file.id+'/complete',{method:'PUT',signal:task.controller.signal,headers:{'X-Conversion-Id':task.jobId,'X-Source-SHA256':result.sourceSha256},body:new Blob([result.buffer],{type:'model/gltf-binary'})});
   if(!owns())return;put(file.id,r.model);onReady(file.id,r.model);
  }catch(e){
   if(owns()){
    if(task.jobId){try{await task.progressQueue.catch(()=>{});if(!owns())return;await api('/api/models/'+file.id+'/progress',{method:'POST',headers:{'X-Conversion-Id':task.jobId},body:JSON.stringify({status:'failed',error:e.message})});if(owns())put(file.id,{...states.get(file.id),status:'failed',error:e.message})}catch{if(owns()){const m=await inspect(file.id,true);if(m?.status==='ready')onReady(file.id,m)}}}
    else{const m=await inspect(file.id,true);if(owns())put(file.id,{...m,notice:e.message})}
   }
  }finally{cleanup()}
 }
 async function cancel(id){
  const task=tasks.get(id),model=states.get(id);if(!model?.jobId)return;
  if(task){task.cancelling=true;task.cancelled=true;task.controller.abort();task.worker?.terminate();clearTimeout(task.timer);task.reject?.(Error('已取消'))}
  try{const r=await api('/api/models/'+id+'/cancel',{method:'POST',headers:{'X-Conversion-Id':model.jobId}});if(tasks.get(id)===task)put(id,r.model)}catch{if(tasks.get(id)===task)await inspect(id,true)}finally{if(tasks.get(id)===task)tasks.delete(id)}
 }
 return {states,tasks,inspect,start,cancel};
}
