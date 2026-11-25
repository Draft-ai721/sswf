import {createConversions,MODEL_STATUS} from './conversion-client.js';
import {mountPdfSheet,pdfSheet} from './final-pdf.js';
import {conceptDesk,conceptDrawing,decisions,pointOnConceptDrawing,revisionBase,taskLabels} from './concept-room.js';
import {finalList,finalDesk,uploadFinalFiles,finalRevisionFields,finalRevisionData,finalVersionUrl} from './final-review.js';
import {workflowSections} from './workflow-report.js';
import {DESIGN_STAGES} from '../shared/design-workflow.js';
import {downloadRoomReport} from './reports.js';
import {downloadFinalReport} from './final-archive.js';
import {esc,category} from './materials.js';
const date=s=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const roles={owner:'项目所有者',reviewer:'受邀评审者',viewer:'只读访客'};
export function createReviewRooms({api,project,projects,save,etag,replaceState,modal,toast,render,closeModal}){
 let closePdf=null,pdfPage=1,finalTab='teacher', aiPending=new Set(), navigation=0;
 let list=null,listLoading=false,record=null,recordId=null,loading=false,error='',listError='',selected='report',discussionFilter='all',viewer=null,mountId=0;
 let activeRevision=null,revisionRequest=0,readingRevision=false,optionId='',mode='plan',anchor=null;
 let comparison=null,referenceViewer=null;
 let camera={yaw:Math.PI/4,pitch:Math.PI/6};
 const viewing=()=>record&&{
   ...record.room,
   ...(activeRevision?{version:activeRevision,revisionSelected:true}:{})
 };
 const forMaterial=()=>{const r=viewing();return r&&{...r,comments:r.comments.filter(c=>!c.versionId?r.version.id===record.room.version.id:c.versionId===r.version.id)}};
 const roomUrl=id=>'/api/review-rooms/'+(id||record.room.id);
 const finalView=(id,version)=>api(roomUrl(id)+'?version='+encodeURIComponent(version));
 const aiKey=r=>r.id+'-'+r.version.id;
 function clearDrawing(){optionId='';mode='plan';anchor=null;camera={yaw:Math.PI/4,pitch:Math.PI/6}}
 async function readVersion(versionId,r=record.room){
   return versionId===r.version.id?r.version:(await api(roomUrl(r.id)+'/versions/'+encodeURIComponent(versionId))).version;
 }
 async function selectVersion(versionId,onReady){
   const roomId=record.room.id,stamp=++revisionRequest;
   readingRevision=true;render();
   try{
     const version=await readVersion(versionId);
     if(record?.room.id!==roomId||stamp!==revisionRequest)return;
     activeRevision=version.id===record.room.version.id?null:version;
     selected='report';pdfPage=1;clearDrawing();
     onReady?.();
   }finally{
     if(record?.room.id===roomId&&stamp===revisionRequest){readingRevision=false;render()}
   }
 }
 async function selectFinalVersion(versionId,keepSelection=false){
   const id=record.room.id,stamp=++revisionRequest;
   readingRevision=true;render();
   try{
     const next=await finalView(id,versionId);
     if(recordId!==id||stamp!==revisionRequest)return;
     record=next;
     if(!keepSelection){selected='report';pdfPage=1;comparison=null}
   }finally{
     if(recordId===id&&stamp===revisionRequest){readingRevision=false;render()}
   }
 }
 function showAnchor(next){
   if(!next||next.kind==='general')return;
   selected='concept-plan';anchor=next;mode=next.kind;optionId=next.optionId;
   if(next.view.camera)camera={...next.view.camera};
 }
 function shareForm(){
   const r=record.room,p=projects().find(p=>p.id===r.projectId);
   const available=(p?.versions||[]).filter(v=>!r.versions.some(shared=>shared.id===v.id)).reverse();
   const safeTitle=p?esc(p.name):'关联项目';
   modal('共享改后版本','选择已有快照，或将当前工作稿保存为固定版本后共享。',`
     ${available.length?`<form id="room-share-revision-form" class="submission-fields"><label>待共享版本<select name="versionId">
     ${available.map(v=>`<option value="${esc(v.id)}">V${v.number} · ${esc(v.label)}</option>`).join('')}</select></label>
     <button class="btn primary" type="submit">共享这个版本</button></form>`:''}
     ${p?`<form id="room-capture-revision-form" class="submission-fields"><p>从「${safeTitle}」保存一份快照。</p>
     <label>版本名称<input name="label" required maxlength="100"></label><label>改了什么<textarea name="note" required maxlength="4000"></textarea></label>
     <button class="btn secondary" type="submit">保存工作稿并共享</button></form>`:'<p>找不到关联项目的可共享版本。</p>'}`);
 }
 async function shareRevision(form,data){
   const r=record.room;
   let versionId=form._versionId||data.versionId;
   if(form.id==='room-capture-revision-form'&&!versionId){
     await save();
     const response=await api('/api/snapshots',{method:'POST',headers:{'If-Match':etag()},body:JSON.stringify({
       projectId:r.projectId,kind:'stage',label:data.label,note:data.note
     })});
     replaceState(response.state,response.etag);
     versionId=form._versionId=response.versionId;
   }
   if(record?.room.id!==r.id)throw Error('讨论室已切换，请重新打开共享窗口。');
   await mutate('versions',{projectVersionId:versionId,requestId:form._requestId||=crypto.randomUUID()});
   closeModal();
   await selectVersion(versionId);
   toast('已向此讨论室共享固定版本。');
 }
 function alignReply(source,original,revision,explicitOption){
   if(!source?.optionId)return null;
   const options=revision.snapshot.workflow?.options||[];
   const option=options.find(o=>o.id===(explicitOption??source.optionId));
   if(!option?.plan)return null;
   const origin=original.snapshot.workflow?.options.find(o=>o.id===source.optionId)?.plan.spaces.find(s=>s.id===source.spaceId);
   const lineage=origin?.sourceSpaceId||origin?.id;
   const space=lineage&&option.plan.spaces.find(s=>(s.sourceSpaceId||s.id)===lineage);
   const result={...source,versionId:revision.id,optionId:option.id,spaceId:space?.id};
   if(result.kind==='mass'&&space)result.xyz=[...result.xyz.slice(0,2),space.height];
   return result;
 }
 function replyForm(id){
   const r=record.room,c=r.comments.find(c=>c.id===id);
   if(!c)return;
   modal('用作品证据回应',esc(c.text),`<form id="room-reply-form" data-id="${esc(c.id)}" class="submission-fields">
     <label>我的回答、判断与下一步修改<textarea name="text" required maxlength="4000" placeholder="说明依据或下一步修改"></textarea></label>
     ${r.kind==='final'?'<label>补交图纸（选填）<input type="file" name="supplement" accept=".skp,.pdf,.jpg,.jpeg,.png" multiple></label>':
      `<label>我的判断<select name="decision">${Object.entries(decisions).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
      <label>附已共享的版本<select name="responseVersionId"><option value="">仅回应文字</option>${r.versions.filter(v=>v.id!==(c.versionId||r.version.id)).map(v=>`<option value="${esc(v.id)}">V${v.number} · ${esc(v.label)}</option>`).join('')}</select></label>
      <label data-response-option hidden>改后位置对应的方案<select name="responseOptionId"></select></label>`}
     <button class="btn primary" type="submit">提交回应，等待复核</button></form>`);
   const form=document.querySelector('#room-reply-form');
   if(r.kind==='final')form.dataset.version=r.version.id;
   const selector=form.elements.responseVersionId;
   if(selector&&c.anchor?.optionId)selector.onchange=async()=>{
     const value=selector.value,wrapper=form.querySelector('[data-response-option]');
     wrapper.hidden=true;form.elements.responseOptionId.replaceChildren();
     if(!value)return;
     try{
       const version=await readVersion(value,r);
       if(!form.isConnected||selector.value!==value)return;
       const options=version.snapshot.workflow?.options||[];
       form.elements.responseOptionId.add(new Option('仅打开改稿',''));
       for(const o of options){
         const row=new Option(o.title,o.id,false,o.id===c.anchor.optionId);
         form.elements.responseOptionId.add(row);
       }
       wrapper.hidden=!options.length;
     }catch(error){if(form.isConnected)toast(error.message)}
   };
 }
 function dispose(){closePdf?.();closePdf=null;mountId++;viewer?.dispose();viewer=null;referenceViewer?.dispose();referenceViewer=null}
 const login=()=>`<a class="btn primary" href="/login?return_to=${encodeURIComponent('/'+location.hash)}" target="_top">登录后继续</a>`;
 async function refresh(id){const stamp=navigation;loading=true;error='';try{const next=location.hash.startsWith('#/final/')?await finalView(id,'latest'):await api(roomUrl(id));if(stamp!==navigation)return;record=next;recordId=id;if(next.room.kind==='final'&&location.hash==='#/room/'+id)location.replace('#/final/'+id)}catch(e){if(stamp===navigation){error=e.message;record=null}}finally{if(stamp===navigation){loading=false;render()}}}
 async function refreshList(){const stamp=navigation;listLoading=true;try{const result=await api('/api/review-rooms');if(stamp===navigation){list=result.rooms;listError=''}}catch(e){if(stamp===navigation){list=[];listError=e.message}}finally{if(stamp===navigation){listLoading=false;render()}}}
 function create(){const p=project();if(!p?.versions.length)return toast('先保存阶段快照，再创建评审室。');modal('邀请多方，评审一个明确的版本。','评审室只共享所选快照及其中的材料，不开放整个私人工作空间。',`<form id="room-create-form" data-project="${p.id}"><div class="form-field"><label>评审室名称</label><input name="title" required maxlength="100" value="${esc(p.name)} · 方案讨论"></div><div class="form-field"><label>共享版本</label><select name="versionId">${[...p.versions].reverse().map(v=>`<option value="${v.id}">V${v.number} · ${esc(v.label)}</option>`).join('')}</select></div><div class="callout">创建后可生成有期限的邀请链接。评审者邀请绑定邮箱；未被邀请的账号无法访问评审室。</div><div class="modal-actions"><button class="btn primary" type="submit">创建评审室</button></div></form>`)}
 async function createRoom(form){await save();const d=Object.fromEntries(new FormData(form)),r=await api('/api/review-rooms',{method:'POST',body:JSON.stringify({...d,projectId:form.dataset.project})});record=r;recordId=r.room.id;list=null;selected='report';closeModal();location.hash='#/room/'+r.room.id;render()}
 function page(final=false,tab='mine'){if(final){if(list===null&&!listLoading)queueMicrotask(refreshList);if(listError)return `<div class="work-empty">${esc(listError)} ${login()} <button data-action="room-refresh-list">刷新</button></div>`;return list===null?'<p class="work-empty">正在读取评审…</p>':finalList(list,tab==='received'?'received':'mine')}if(list===null&&!listLoading)queueMicrotask(refreshList);return `<div class="page-heading"><div><h1>概念讨论</h1><p>围绕共享的作品版本提出问题、回应和复核。</p></div><button class="btn primary" data-action="room-create">创建评审室</button></div><div class="notice blue">评审权限来自项目所有者的邀请。评审者邀请绑定邮箱；只读访客无法评论。公开网站不会公开私人项目。</div>${listError?`<div class="empty">${esc(listError)}<br>${login()}</div>`:listLoading?'<div class="empty">正在读取评审室…</div>':`<div class="room-grid">${(list||[]).filter(r=>r.kind!=='final').map(r=>`<article class="panel"><span class="tag blue">${roles[r.role]}</span><h2>${esc(r.title)}</h2><p>${esc(r.course)} · V${r.versionNumber} · ${r.comments} 条讨论</p><p>${taskLabels(r.tasks)}${r.tasks?.unread?' · 未读 ' + r.tasks.unread:''}</p><p class="muted">${date(r.createdAt)}</p><a class="btn secondary" href="#/room/${r.id}">进入评审室 →</a></article>`).join('')||'<div class="empty">还没有评审室。项目所有者可从阶段版本创建；受邀评审者从邀请链接加入。</div>'}</div>`}<button class="btn text" data-action="room-refresh-list">刷新列表</button>`}
 function room(id){
   if(recordId!==id&&!loading){recordId=id;record=null;selected='report';discussionFilter='all';queueMicrotask(()=>refresh(id))}
   if(!record)return `<div class="empty">${error?esc(error):'正在读取共享版本…'}${error?'<br>'+login()+'<button class="btn secondary" data-action="room-refresh">重新读取</button>':''}</div>`;
   const r=viewing(),p=r.version.snapshot;
   if(r.kind==='final')return finalDesk(r,{selected,tab:finalTab,material,pdfPage,aiBusy:aiPending.has(aiKey(r)),comparison,loading:readingRevision});
   const report=`<h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><p><b>目标：</b>${esc(p.goal||'待说明')}</p>
     ${workflowSections(p,{reviewer:r.role==='reviewer',fileUrl:id=>revisionBase(r)+'/files/'+id})}
     <h3>个人汇报</h3>${p.report.split(/\n\s*\n/).filter(Boolean).map((value,i)=>`<article class="room-paragraph"><small>第 ${i+1} 段</small>
       <p>${esc(value).replace(/\n/g,'<br>')}</p>${r.role==='reviewer'?`<button class="btn text" data-action="room-comment" data-id="report-${i+1}">围绕此段提问 →</button>`:''}</article>`).join('')}
     <h3>依据与改写理由</h3><p>${esc(p.reason)}</p><p>${esc(p.evidence)}</p>`;
   return conceptDesk(r,{selected,filter:discussionFilter,report,loading:readingRevision,
     canvas:selected==='concept-plan'?conceptDrawing(r,{optionId,mode,camera,anchor}):'',
     material:selected!=='report'&&selected!=='concept-plan'?material(forMaterial(),p.files.find(f=>f.id===selected)):'',
     invites:r.role==='owner'?invites(r):''});
 }
 function sourceLabel(r,id){return id.startsWith('option-')?'备选方案 · '+(r.version.snapshot.workflow?.options.find(o=>o.id===id.slice(7))?.title||'版本方案'):id.startsWith('workflow-')?'设计阶段 · '+(DESIGN_STAGES[Number(id.slice(9))-1]?.name||'未知'):id==='project'?'项目整体':id.startsWith('report-')?'汇报第 '+id.slice(7)+' 段':r.version.snapshot.files.find(f=>f.id===id)?.name||'版本材料'}
 function material(r,f){if(!f)return '<p>请选择版本材料。</p>';const base=revisionBase(r);return `<h3>${esc(f.name)}</h3><p class="muted">${esc(category(f))} · ${esc(f.versionLabel||'初始上传')}<br>${esc(f.purpose||'')}</p>${f.type==='skp'?f.conversion?.status==='ready'?'<div class="model-area room-model" id="room-model" data-file="'+esc(f.id)+'"><div class="model-loading">正在加载共享模型…</div></div><div class="row"><button class="btn secondary small" data-action="room-camera">轴测复位</button>'+(r.role==='reviewer'?'<button class="btn secondary small" data-action="room-pin">在模型表面定位提问</button>':'')+'</div>':'<div class="empty">此快照未保存可用的模型转换结果。</div>':f.type==='pdf'?pdfSheet(r,f,pdfPage,base):`<div class="room-image-stage"><img class="shared-image" id="room-image" data-file="${f.id}" alt="${esc(f.name)}${r.role==='reviewer'?'，点击图纸添加定位问题':''}" src="${base}/files/${f.id}">${r.comments.filter(c=>c.source===f.id&&c.imagePoint).map((c,i)=>`<button class="room-image-pin ${c.status==='已完成'?'resolved':''}" style="left:${c.imagePoint.x*100}%;top:${c.imagePoint.y*100}%" data-action="room-locate" data-id="${c.id}" aria-label="${esc(c.text)}">${i+1}</button>`).join('')}</div>${r.role==='reviewer'?'<p class="muted">点击图纸上的具体位置提出问题，批注绑定此提交版本。</p>':''}`}<div class="row"><a class="btn text" href="${base}/files/${f.id}" download>下载此版本原文件</a>${r.role==='reviewer'?`<button class="btn text" data-action="room-comment" data-id="${f.id}">围绕此材料提问</button>`:''}</div>`}
 function invites(r){return `<section class="panel invite-panel"><h2>共享与授权</h2><form id="room-invite-form"><div class="form-field"><label>邀请角色</label><select name="role"><option value="reviewer">评审者 · 可提问和复核</option><option value="viewer">只读访客</option></select></div><div class="form-field"><label>参与视角</label><select name="perspective"><option>教师</option>${r.kind==='final'?'':'<option>同伴</option><option>使用者</option>'}</select></div><div class="form-field"><label>受邀账号邮箱</label><input type="email" name="email" maxlength="200" placeholder="评审者邀请必须填写"><small>须与受邀者登录账号邮箱一致。只读邀请若不填邮箱，持链接并登录的人都可加入。</small></div><div class="form-field"><label>有效期</label><select name="days"><option value="7">7 天</option><option value="1">1 天</option><option value="30">30 天</option></select></div><button class="btn primary small" type="submit">生成邀请链接</button></form><div class="invite-list">${r.invites.map(i=>`<article><b>${roles[i.role]}</b><p>${esc(i.email||'持链接可加入')}<br>至 ${date(i.expiresAt)} · 已加入 ${i.acceptedCount||0} 人</p>${i.revoked?'<span class="tag gray">已撤销</span>':`<button class="btn text" data-action="room-revoke" data-id="${i.id}">撤销授权</button>`}</article>`).join('')}</div></section>`}
 async function mutate(action,data){
   const original=record, stamp=navigation;
   if(original.room.kind==='final'&&action!=='versions'){
     if(data.versionId&&data.versionId!==original.room.version.id)throw Error('评阅版本已切换，请重新打开操作窗口。');
     data={...data,versionId:original.room.version.id};
   }
   const result=await api(roomUrl(original.room.id)+'/'+action,{method:'POST',headers:{'If-Match':original.etag},body:JSON.stringify(data)});
   if(stamp===navigation&&record?.room.version.id===original.room.version.id){
     record={room:{...result.room,aiReview:result.room.version.id===record.room.version.id?record.room.aiReview:null},etag:result.etag};list=null;
   }
   return result;
 }
 function comment(source,point,imagePoint=null,planAnchor=null){if(record?.room.role!=='reviewer')return;modal('留下一个有依据的问题',esc(sourceLabel(viewing(),source))+(point?' · 已绑定模型位置与视角':imagePoint?' · 已绑定图纸位置':''),`<form id="room-comment-form" data-source="${source}"><div class="form-field"><label>讨论类型</label><select name="kind"><option>问题</option><option>批注</option><option>修改任务</option></select></div><div class="form-field"><label>问题或意见</label><textarea name="text" required maxlength="4000"></textarea></div><div class="form-field"><label>建议补充的材料或后续任务</label><textarea name="task" maxlength="1000"></textarea></div><div class="modal-actions"><button class="btn primary" type="submit">发布到评审室</button></div></form>`);document.querySelector('#room-comment-form')._point=point||null;const form=document.querySelector('#room-comment-form');
 form._imagePoint=imagePoint;form._anchor=planAnchor;form._versionId=viewing().version.id}
 async function submit(form){const d=Object.fromEntries(new FormData(form));
 if(form.id==='room-final-revision-form'){
   const room=record.room,stamp=navigation;
   try{
     const data=await finalRevisionData(form,api);
     if(stamp!==navigation||record?.room.version.id!==room.version.id)throw Error('评阅版本已切换，请重新打开修订窗口。');
     await mutate('versions',data);
     if(stamp!==navigation)return;
     selected='report';pdfPage=1;comparison=null;finalTab='teacher';closeModal();render();toast('修订版已提交。');
   }catch(error){form.querySelector('output').textContent=error.message;throw error}
   return;
 }
 if(['room-share-revision-form','room-capture-revision-form'].includes(form.id))return shareRevision(form,d);
 if(form.id==='room-verdict-form'){await mutate('verdict',{decision:d.decision,text:d.text,versionId:form.dataset.version,requestId:form._requestId||=crypto.randomUUID()});closeModal();render();return}if(form.id==='room-create-form')return createRoom(form);if(form.id==='room-invite-form'){const result=await mutate('invites',d);render();modal('邀请链接已生成','请将链接分享给受邀者。撤销或到期后，已加入的账号也将失去访问权限。',`<div class="form-field"><label>邀请链接</label><input readonly id="room-invite-url" value="${esc(result.inviteUrl)}"></div><div class="modal-actions"><button class="btn primary" data-action="room-copy">复制链接</button></div>`);return}if(form.id==='room-comment-form')await mutate('comments',{...d,source:form.dataset.source,point:form._point,imagePoint:form._imagePoint,
   requestId:form._requestId||=crypto.randomUUID(),versionId:form._versionId,anchor:form._anchor});else if(form.id==='room-reply-form'){
   const r=record.room;
   const input=form.elements.supplement;
   const files=input?.files.length?await uploadFinalFiles([...input.files],api,()=>{},form.uploadCache||=new Map()):[];
   if(record?.room.id!==r.id||r.kind==='final'&&record.room.version.id!==form.dataset.version)throw Error('评阅版本已切换，请重新打开回应窗口。');
   const payload={text:d.text,commentId:form.dataset.id,files,...(r.kind==='final'?{versionId:form.dataset.version,requestId:form._requestId||=crypto.randomUUID()}:{})};
   if(r.kind!=='final'){
     const c=r.comments.find(c=>c.id===form.dataset.id);
     if(!c)throw Error('该问题已不可用，请刷新讨论。');
     Object.assign(payload,{decision:d.decision,requestId:form._requestId||=crypto.randomUUID()});
     if(d.responseVersionId){
       const [original,revision]=await Promise.all([readVersion(c.versionId||r.version.id,r),readVersion(d.responseVersionId,r)]);
       payload.responseVersionId=revision.id;
       payload.responseAnchor=alignReply(c.anchor,original,revision,form.elements.responseOptionId.options.length?d.responseOptionId:undefined);
     }
     if(record?.room.id!==r.id)throw Error('讨论室已切换，请重新打开回应窗口。');
   }
   await mutate('reply',payload);
 }else return;closeModal();render();toast('评审记录已保存。')}
 async function action(a,b){if(a==='room-final-convert'){
   const room=record.room,file=room.version.snapshot.files.find(f=>f.id===b.dataset.id);if(!file)return;
   b.disabled=true;const status=document.querySelector('#final-conversion-status');
   const conversion=createConversions({api,update(id,state){if(status)status.textContent=MODEL_STATUS[state.status]||state.status},onReady(){}});
   try{await conversion.start(file);if(record?.room.id===room.id&&record.room.version.id===room.version.id){await mutate('refresh-model',{fileId:file.id,versionId:room.version.id});render()}}finally{b.disabled=false}
 }
 else if(a==='room-final-tab'){finalTab=b.dataset.id;render()}
 else if(a==='room-final-version')await selectFinalVersion(b.dataset.id);
 else if(a==='room-final-revise'){
   const r=record.room;
   modal('提交修订版','基于 V'+r.version.number+'，选好新一版评阅的完整材料。',finalRevisionFields(r));
 }
 else if(a==='room-final-compare'){
   if(comparison){comparison=null;render();return}
   const room=record.room,version=room.version;
   const previous=(await finalView(room.id,version.parentVersionId)).room;
   if(record?.room.id!==room.id||record.room.version.id!==version.id||!b.isConnected)return;
   const models=previous.version.snapshot.files.filter(f=>f.type==='skp'&&f.conversion?.status==='ready');
   const file=models.find(f=>f.id===b.dataset.id)||models[0];
   if(!file){toast('上一版暂无已转换的模型。');return}
   const point=previous.comments.findLast(c=>c.source===file.id&&c.point)?.point;
   comparison={number:previous.version.number,file,base:revisionBase(previous),camera:point?.camera};render();
 }
 else if(a==='room-final-invite'){modal('邀请老师评阅',esc(record.room.title),invites(record.room))}
 else if(a==='room-final-verdict'){const r=record.room;modal('发布教师总评',esc(r.title)+' · V'+r.version.number,`<form id="room-verdict-form" data-version="${esc(r.version.id)}" class="submission-fields"><label>审查结论<select name="decision"><option>已评阅</option><option>需补充</option><option>需修改</option></select></label><label>教师评语<textarea name="text" required rows="5" maxlength="4000"></textarea></label><button class="btn primary" type="submit">发布总评</button></form>`)}
 else if(a==='room-final-ai'){
   const original=record,r=original.room;
   const modelFile=document.querySelector('#room-model')?.dataset.file;
   const resultId=r.version.snapshot.files.find(f=>f.id===modelFile)?.conversion?.resultId;
   const modelViews=viewer&&resultId?viewer.captureViews().map(v=>({...v,fileId:modelFile,resultId})):[];
   const pending=aiKey(r);if(aiPending.has(pending))return;aiPending.add(pending);render();
   const key='final-ai-'+pending,requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
   try{const {run}=await api('/api/ai/generate',{method:'POST',headers:{'If-Match':original.etag},body:JSON.stringify({kind:'review',projectId:'final-'+r.id,finalRoomId:r.id,submissionVersionId:r.version.id,requestId,views:modelViews})});
     if(run.status==='failed'){sessionStorage.removeItem(key);throw Error(run.error||'生成失败，请重试。')}
     if(run.status==='running')toast('任务仍在处理，稍后可刷新查看。');
   }catch(e){if(e.status)sessionStorage.removeItem(key);throw e}
   finally{aiPending.delete(pending);if(record?.room.id===r.id&&record.room.version.id===r.version.id&&!readingRevision)await selectFinalVersion(r.version.id,true)}
 }
 else if(a==='room-final-ai-source'){
   const r=record.room,row=r.aiReview?.comments[Number(b.dataset.index)];
   if(!row?.fileId)return;
   selected=row.fileId;pdfPage=row.page||1;comparison=null;render();
   const el=document.querySelector('#room-model');
   if(el&&row.camera&&r.version.snapshot.files.find(f=>f.id===row.fileId)?.conversion?.resultId===row.resultId)el._restoreCamera=row.camera;
   document.querySelector('#room-model,#room-image,[data-pdf-sheet]')?.scrollIntoView({block:'center'});
 }
 else if(a==='room-share-revision')shareForm()
 else if(a==='room-concept-mode'){mode=b.dataset.value;anchor=null;render()}
 else if(a==='room-concept-turn'){const yaw=camera.yaw+Number(b.dataset.value)*Math.PI/6;camera.yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));anchor=null;render()}
 else if(a==='room-read-tasks'){
   const r=record.room,result=await api(roomUrl(r.id)+'/read-tasks',{method:'POST',body:JSON.stringify({eventIds:r.tasks.map(task=>task.id)})});
   if(record?.room.id===r.id){record.room.taskSummary=result.taskSummary;list=null;render()}
 }
 else if(a==='room-locate-reply'){
   const reply=record.room.comments.find(c=>c.id===b.dataset.id)?.replies.find(reply=>reply.id===b.dataset.reply);
   if(reply?.responseVersionId)await selectVersion(reply.responseVersionId,()=>showAnchor(reply.responseAnchor));
 }
 else if(a==='room-export'){
   b.disabled=true;
   try{
     const r=viewing();
     if(r.kind==='final')await downloadFinalReport(r,viewer?{fileId:document.querySelector('#room-model')?.dataset.file,thumbnail:viewer.snapshot().thumbnail}:null);
     else await downloadRoomReport(r);
     toast('已导出所选版本的评阅档案，可打印为 PDF。');
   }finally{b.disabled=false}
 }
 else if(a==='room-refresh'){
   if(record?.room.kind==='final')await selectFinalVersion(record.room.version.id,true);else await refresh(recordId);
 }
 else if(a==='room-review-filter'){discussionFilter=b.dataset.value;render()}else if(a==='room-create')create();else if(a==='room-refresh-list'){list=null;await refreshList()}else if(a==='room-material'){selected=b.dataset.id;pdfPage=1;comparison=null;if(selected==='concept-plan')clearDrawing();render()}else if(a==='room-comment')comment(b.dataset.id);else if(a==='room-reply')replyForm(b.dataset.id);else if(a==='room-resolve'){await mutate('resolve',{commentId:b.dataset.id,status:b.dataset.status,requestId:b.dataset.requestId||=crypto.randomUUID()});render()}else if(a==='room-revoke'){await mutate('revoke',{inviteId:b.dataset.id});render();toast('此邀请及通过它加入的授权已撤销。')}else if(a==='room-copy'){const el=document.querySelector('#room-invite-url');try{await navigator.clipboard.writeText(el.value);toast('邀请链接已复制。')}catch{el.select();toast('请复制已选中的链接。')}}else if(a==='room-pin'){if(!viewer)return toast('请等待共享模型加载完成。');viewer.annotate();toast('点击模型表面选择问题位置。')}else if(a==='room-camera')viewer?.setView('轴测');else if(a==='room-locate'){
   const c=record.room.comments.find(c=>c.id===b.dataset.id);
   if(!c)return;
   const pick=()=>{
     pdfPage=c.imagePoint?.page||1;
     selected=c.source==='project'||['report-','workflow-','option-'].some(prefix=>c.source.startsWith(prefix))?'report':c.source;
     showAnchor(c.anchor);
   };
   if(record.room.kind==='final'){comparison=null;pick();render()}
   else await selectVersion(c.versionId||record.room.version.id,pick);
   if(c.point){const el=document.querySelector('#room-model');if(el)el._restoreCamera=c.point.camera}
   else if(c.imagePoint){document.querySelector('#room-image,[data-pdf-sheet]')?.scrollIntoView({block:'center'})}
   else if(selected==='report'){
     if(c.source.startsWith('option-')||c.source.startsWith('workflow-'))document.getElementById(c.source)?.scrollIntoView({block:'center'});
     else if(c.source.startsWith('report-'))document.querySelectorAll('.room-paragraph')[Number(c.source.slice(7))-1]?.scrollIntoView({block:'center'});
   }
 }}

 async function mount(){
 document.querySelector('#room-final-version')?.addEventListener('change',event=>selectFinalVersion(event.target.value).catch(error=>toast(error.message)));
 document.querySelector('#room-concept-version')?.addEventListener('change',event=>selectVersion(event.target.value).catch(error=>toast(error.message)));
 document.querySelector('#room-concept-option')?.addEventListener('change',event=>{optionId=event.target.value;anchor=null;render()});
 const canvas=document.querySelector('[data-room-concept-canvas]');
 if(canvas&&record?.room.role==='reviewer')canvas.querySelector('svg').addEventListener('click',event=>{
   const next=pointOnConceptDrawing(event,canvas,viewing(),mode,camera);
   if(next)comment('option-'+next.optionId,null,null,next);
 });
 const r=forMaterial();
 if(!r)return;
 const sheet=document.querySelector('[data-pdf-sheet]');
 if(sheet)closePdf=mountPdfSheet(sheet,r,comment,page=>pdfPage=page,revisionBase(r));
 const image=document.querySelector('#room-image');
 if(image&&r.role==='reviewer')image.addEventListener('click',e=>{
   const bounds=image.getBoundingClientRect();
   if(bounds.width&&bounds.height)comment(image.dataset.file,null,{
     x:Math.max(0,Math.min(1,(e.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(e.clientY-bounds.top)/bounds.height))
   });
 });
 const el=document.querySelector('#room-model'),reference=document.querySelector('#final-reference-model'),compared=comparison;
 if(!el)return;
 const mount=++mountId,active=node=>mount===mountId&&node.isConnected;
 const feedback=node=>node.querySelector('.model-loading');
 try{
   const mod=await import('./model-viewer.js');
   if(!active(el))return;
   if(reference&&compared)void mod.createModelViewer(reference,compared.base+'/models/'+compared.file.id,[],()=>{},()=>{}).then(result=>{
     if(!active(reference)){result.dispose();return}
     referenceViewer=result;feedback(reference)?.remove();
     if(compared.camera)result.restore(compared.camera);
   }).catch(error=>{if(active(reference))feedback(reference).textContent='旧版模型读取失败。'+error.message});
   const fileId=el.dataset.file||selected,file=r.version.snapshot.files.find(f=>f.id===fileId);
   const pins=r.comments.filter(c=>c.source===fileId&&c.point&&(!c.point.resultId||c.point.resultId===file?.conversion?.resultId))
     .map(c=>({id:c.id,text:c.text,position:c.point.position}));
   const result=await mod.createModelViewer(el,revisionBase(r)+'/models/'+fileId,pins,point=>{
     if(r.kind==='final'){
       point.resultId=file.conversion.resultId;
       const {thumbnail}=viewer.snapshot(320,.55);
       if(thumbnail.length<37000)point.thumbnail=thumbnail;
     }
     comment(fileId,point);
   },id=>{const c=r.comments.find(c=>c.id===id);viewer?.restore(c.point.camera);toast(c.text)});
   if(!active(el)){result.dispose();return}
   viewer=result;feedback(el)?.remove();
   if(el._restoreCamera)viewer.restore(el._restoreCamera);
 }catch(error){if(active(el))feedback(el).textContent='模型视图暂不可用。'+error.message}
 }
 let accepting=null;function invite(token){if(accepting!==token){accepting=token;error='';queueMicrotask(async()=>{try{const r=await api('/api/review-rooms/accept',{method:'POST',body:JSON.stringify({token})});list=null;recordId=null;location.hash=(r.kind==='final'?'#/final/':'#/room/')+r.roomId}catch(e){error=e.message;render()}})}return `<div class="empty"><h2>加入版本评审</h2><p>${esc(error||'正在验证邀请与登录账号…')}</p>${error?login():''}</div>`}
 return {onNavigate(){navigation++;revisionRequest++;readingRevision=false;activeRevision=null;comparison=null;clearDrawing();loading=false;listLoading=false;listError='';pdfPage=1;record=null;recordId=null;list=null;finalTab='teacher';error='';dispose()},page,room,invite,create,submit,action,mount,dispose};
}
