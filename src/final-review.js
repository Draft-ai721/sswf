import {createConversions,MODEL_STATUS} from './conversion-client.js';
import {pdfSheet} from './final-pdf.js';
import {esc} from './materials.js';
import {workActions} from './work-actions.js';
import {extractReviewPdf,reviewCover} from './studio-pdf.js';
import {revisionBase} from './concept-room.js';
import {planSvg,axonSvg} from '../shared/space-planning.js';

const date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export const finalVersionUrl=(room,versionId=room.version.id)=>'/api/review-rooms/'+room.id+'/versions/'+versionId;

export function coverageText(row){
  return [row.textPages?.length?'第 '+row.textPages.join('、')+' 页文字':'',row.legacyText?'旧版提取文字':'',
    row.pdfTruncated?'文字提取有截断':'',row.imagePages?.length?'第 '+row.imagePages.join('、')+' 页图像':row.imageSent?'原图':'' ,
    row.modelViews?.length?row.modelViews.map(view=>view.label).join('、')+'视图':'',
    row.metadataOnly?'仅模型元数据':'',row.listOnly?'仅材料名称':''].filter(Boolean).join(' · ');
}

export function submissionPage(projects, guest) {
  if(guest)return '<section class="work-page"><h1>提交作品</h1><a class="btn primary" href="/login?return_to=%2F%23%2Ffinal-new">登录后上传</a></section>';
  const options=[];
  for(const project of projects) for(const version of project.versions) for(const option of version.snapshot.workflow?.options||[]) {
    if(option.plan)options.push(`<option value="${esc(JSON.stringify([project.id,version.id,option.id]))}">${esc(project.name)} · V${version.number} · ${esc(option.title)}</option>`);
  }
  return `<section class="work-page submit-page"><a class="back-link" href="#/finals">← 作品评阅</a><h1>提交作品</h1>
    <p>可以直接上传已有作品，也可以导入保存过的概念方案。</p>
    <form id="final-submit-form" class="submission-form">
    <fieldset><legend>作品材料</legend><label class="file-pick">选择模型、展板或图纸<input type="file" name="files" accept=".skp,.pdf,.jpg,.jpeg,.png" multiple><small>SKP、PDF、JPG、PNG · 最多 3 份，每份 20 MB</small></label>
    ${options.length?`<details><summary>从概念生成导入</summary><label>只导入所选方案的平面和体块<select name="source"><option value="">使用上传的材料</option>${options.join('')}</select></label></details>`:''}</fieldset>
    <fieldset><legend>作品信息</legend><label>作品名称<input name="title" required maxlength="100"></label><label>设计说明或希望评阅的问题（选填）<textarea name="focus" rows="5" maxlength="3000"></textarea></label>
    <small>提交后可以单独请求 AI 点评，或邀请老师审查。</small><button class="btn primary" type="submit">提交并查看作品</button><output aria-live="polite"></output></fieldset></form></section>`;
}
export async function uploadFinalFiles(files,api,status,cache=new Map()) {
  if(!files.length||files.length>3)throw Error('请选择一至三份作品材料。');
  for(const file of files)if(!/\.(skp|pdf|jpe?g|png)$/i.test(file.name)||file.size>20*1024*1024||!file.size)throw Error('请选择有效的 SKP、PDF、JPG 或 PNG，每份最多 20 MB。');
  const result=[];
  for(const file of files){
    if(!cache.has(file)){
      status('正在上传 '+file.name);
      const {file:stored}=await api('/api/final-files?name='+encodeURIComponent(file.name),{method:'POST',body:file});
      let text={};
      if(stored.type==='pdf'){try{text=await extractReviewPdf(file)}catch{/* The original remains available to the reviewer. */}}
      let previewId=null;
      if(stored.type==='pdf'){
        try{
          const cover=await reviewCover(file);
          if(cover){const sample=await api('/api/final-files?name=cover.jpg&parentId='+stored.id+'&page=1',{method:'POST',body:cover});previewId=sample.file.id}
        }catch{/* Reviewers can still read the full original. */}
      }
      if(stored.type==='skp'){
        const conversions=createConversions({api,update(id,state){status(file.name+' · '+(MODEL_STATUS[state.status]||state.status)+(state.error?' · '+state.error:''))},onReady(){}});
        await conversions.start(stored);
      }
      cache.set(file,{id:stored.id,...text,previewId});
    }
    result.push(cache.get(file));
  }
  return result;
}
export async function submitWork(form,api) {
  const {files,title,focus,source}=form.elements;
  const status=message=>form.querySelector('output').textContent=message;
  const data={kind:'final',title:title.value.trim(),focus:focus.value.trim(),requestId:form.requestId||=crypto.randomUUID()};
  if(source?.value && files.files.length)throw Error('请选择上传材料或导入一个方案。');
  try{
    if(source?.value)[data.projectId,data.versionId,data.optionId]=JSON.parse(source.value);
    else data.files=await uploadFinalFiles([...files.files],api,status,form.uploadCache||=new Map());
    status('正在保存提交件…');
    const result=await api('/api/review-rooms',{method:'POST',body:JSON.stringify(data)});
    location.hash='#/final/'+result.room.id;
  }catch(e){status(e.message);throw e}
}

export function finalRevisionFields(room){
  const work=room.version.snapshot;
  return `<form id="room-final-revision-form" class="submission-fields" data-version="${esc(room.version.id)}">
    ${work.files.length?`<fieldset><legend>沿用上一版原件</legend>${work.files.map(file=>
      `<label class="final-keep"><input type="checkbox" name="keepFile" value="${esc(file.id)}" checked> ${esc(file.name)}</label>`).join('')}</fieldset>`:''}
    ${work.drawing?'<label class="final-keep"><input type="checkbox" name="keepDrawing" checked> 沿用上一版的平面与体块</label>':''}
    <label>新增或替换材料<input type="file" name="files" multiple accept=".skp,.pdf,.jpg,.jpeg,.png"><small>取消勾选要替换的原件。新一版合计最多 3 份，每份 20 MB。</small></label>
    <label>修订说明<textarea name="note" required maxlength="3000" rows="4"></textarea></label>
    <label>本版设计说明（选填）<textarea name="focus" maxlength="3000" rows="3">${esc(work.description)}</textarea></label>
    <button type="submit" class="btn primary">提交此版</button><output aria-live="polite"></output></form>`;
}

export async function finalRevisionData(form,api){
  const fields=new FormData(form),files=[...form.elements.files.files],kept=fields.getAll('keepFile').map(id=>({id}));
  const keepDrawing=fields.has('keepDrawing');
  if(keepDrawing&&files.length)throw Error('上传替换材料前，请取消沿用平面与体块。');
  if(!keepDrawing&&(kept.length+files.length<1||kept.length+files.length>3))throw Error('每版需要一至三份材料。');
  const status=message=>form.querySelector('output').textContent=message;
  const uploaded=files.length?await uploadFinalFiles(files,api,status,form.uploadCache||=new Map()):[];
  status('正在保存修订件…');
  return {parentVersionId:form.dataset.version,keepDrawing,files:[...kept,...uploaded],note:fields.get('note'),focus:fields.get('focus'),
    requestId:form.requestId||=crypto.randomUUID()};
}

export function finalList(list,tab) {
  const rows=list.filter(r=>r.kind==='final'&&Boolean(r.trashedAt)===(tab==='trash')&&(r.role==='owner')===(tab!=='received'));
  const empty={mine:'还没有提交作品。可以直接上传已有模型、展板或图纸。',received:'接受评阅邀请后，作品会显示在这里。',trash:'回收站里没有作品。'};
  return `<section class="work-page"><div class="work-heading"><h1>作品评阅</h1><a class="btn primary" href="#/final-new">＋ 提交作品</a></div>
    <nav class="work-tabs" aria-label="评阅范围">${[['mine','我提交的'],['received','邀请我评阅的'],['trash','回收站']].map(([key,name])=>`<a href="#/finals/${key}" ${tab===key?'aria-current="page"':''}>${name}</a>`).join('')}</nav>
    ${rows.map(r=>{
      const row=`<a class="work-row" href="#/final/${esc(r.id)}"><strong>${esc(r.title)}</strong><small>V${r.versionNumber} · ${r.trashedAt?'已移到回收站':r.verdicts?.length?esc(r.verdicts.map(v=>v.author+' '+v.decision).join(' / ')):r.versionNumber>1?'待复核':'待评阅'}${!r.trashedAt&&r.pending?' · '+r.pending+' 条待处理':''}</small><span>→</span></a>`;
      return r.role==='owner'?`<article class="work-list-item">${row}${workActions(r.id,r.trashedAt?
        [['room-final-restore','恢复作品']]:[['room-final-quick-export','导出最新版'],['room-final-trash','移到回收站']])}</article>`:row;
    }).join('')||`<p class="work-empty">${empty[tab]}</p>`}</section>`;
}
export function finalDesk(room,{selected,tab,material,aiBusy,pdfPage,comparison,loading}) {
  const work=room.version.snapshot, owner=room.role==='owner'&&!room.trashedAt, reviewer=room.role==='reviewer';
  const file=work.files.find(f=>f.id===selected)||work.files[0];
  const drawing=work.drawing;
  const retry=file?.type==='skp'&&file.conversion?.status!=='ready'?`<p class="muted">${esc(MODEL_STATUS[file.conversion?.status]||'等待转换')}</p>
    ${owner?`<button class="btn secondary" data-action="room-final-convert" data-id="${esc(file.id)}">转换 / 重试模型</button><output id="final-conversion-status" aria-live="polite"></output>`:''}`:'';
  const base=revisionBase(room),version=room.version;
  const evidence=drawing ? (selected==='axon'?axonSvg(drawing.plan,drawing.program):planSvg(drawing.plan,drawing.program)) : file?.type==='pdf'?pdfSheet(room,file,pdfPage,base):file?material(room,file):'';
  const tabs=drawing?[['plan','平面'],['axon','体块']]:work.files.map(f=>[f.id,f.name]);
  const active=drawing?(selected==='axon'?'axon':'plan'):file?.id;
  const comments=room.comments.map(c=>`<article class="evaluation"><small>${esc(c.authorName||c.author)} · ${esc(c.status)}</small>
    <button class="location" data-action="room-locate" data-id="${esc(c.id)}">${esc(work.files.find(f=>f.id===c.source)?.name||'整件作品')}${c.imagePoint?.page?' · 第 '+c.imagePoint.page+' 页':''} ↗</button><p>${esc(c.text)}</p>${c.task?`<p>${esc(c.task)}</p>`:''}
    ${c.replies.map(r=>`<blockquote>${esc(r.text)}${(r.files||[]).map(f=>`<a href="${base}/files/${f.id}" target="_blank" rel="noopener">补交 · ${esc(f.name)} ↗</a>`).join('')}</blockquote>`).join('')}
    ${owner?`<button class="btn text" data-action="room-reply" data-id="${c.id}">回应与补交</button>`:c.canResolve&&c.status!=='已完成'?`<button class="btn text" data-action="room-resolve" data-id="${c.id}" data-status="已完成">复核完成</button>`:''}</article>`).join('');
  const verdicts=(room.verdicts||[]).map(v=>`<article class="evaluation"><small>${esc(v.author)} · ${esc(v.decision)} · ${date(v.createdAt)}</small><p>${esc(v.text)}</p></article>`).join('');
  const result=room.aiReview;
  const list=(label,rows)=>rows?.length?`<h3>${label}</h3><ul>${rows.map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`:'';
  const ai=result?`<small>${esc(result.provider)} · ${esc(result.model)}</small><p>${esc(result.summary)}</p>
    ${result.coverage?.length?`<details><summary>本次材料读取范围</summary><ul>${result.coverage.map(row=>`<li>${esc(row.name)} · ${esc(coverageText(row))}</li>`).join('')}</ul></details>`:''}
    ${list('已有依据的优点',result.strengths)}${list('还需补充的材料',result.missingMaterials)}
    ${result.comments.map((c,i)=>`<article class="evaluation"><small>${esc(c.kind)}</small><h3>${esc(c.title)}</h3>
      ${c.fileId?`<button class="btn text" data-action="room-final-ai-source" data-index="${i}">${esc(c.location)} ↗</button>`:`<small>${esc(c.location)}</small>`}
      ${c.quote?`<blockquote>${esc(c.quote)}</blockquote>`:''}<p><b>依据</b> ${esc(c.evidence)}</p>
      ${c.need?`<p><b>待补充</b> ${esc(c.need)}</p>`:''}<p><b>建议</b> ${esc(c.suggestion)}</p>
      ${c.question?`<p><b>追问</b> ${esc(c.question)}</p>`:''}</article>`).join('')}${list('可供教师选择的追问',result.teacherQuestions)}`:
    `<p class="work-empty">此版暂无 AI 点评。PDF 文字最多提取前 10 页，图像和模型视图取决于服务能力。</p>${owner?`<button class="btn secondary" data-action="room-final-ai" ${aiBusy?'disabled':''}>${aiBusy?'正在生成…':'生成 AI 点评'}</button>`:''}`;
  const canCompare=version.parentVersionId&&file?.type==='skp'&&file.conversion?.status==='ready';
  const compare=canCompare&&comparison?`<div class="final-model-comparison"><div><p>V${comparison.number} · 旧版参考</p><div id="final-reference-model" class="model-area room-model"><p class="model-loading">正在加载旧版模型…</p></div></div><div><p>V${version.number} · 当前评阅</p>${evidence}</div></div>`:evidence;
  const history=`<ol class="final-history">${room.versions.map(v=>`<li><button class="btn text" data-action="room-final-version" data-id="${esc(v.id)}">V${v.number} · ${esc(v.label)}</button><small>${date(v.createdAt)}</small></li>`).join('')}</ol>`;
  const reviewHistory=room.verdictHistory?.length?`<details><summary>本版教师评阅记录</summary>${room.verdictHistory.map(v=>
    `<article class="evaluation"><small>${esc(v.author)} · ${esc(v.decision)} · ${date(v.createdAt)}</small><p>${esc(v.text)}</p></article>`).join('')}</details>`:'';
  return `<section class="final-desk"><a class="back-link" href="#/finals">← 作品评阅</a><div class="work-heading"><h1>${esc(room.title)}</h1>${owner?'<button class="btn secondary" data-action="room-final-invite">邀请老师</button>':''}</div>
    ${room.trashedAt?'<p>作品在回收站。<a href="#/finals/trash">前往回收站恢复</a></p>':''}
    <div class="final-version-strip row"><label>作品版本 <select id="room-final-version" ${loading?'disabled':''}>${room.versions.map(v=>`<option value="${esc(v.id)}" ${v.id===version.id?'selected':''}>V${v.number} · ${esc(v.label)}</option>`).join('')}</select></label>
    ${owner&&version.id===room.latestVersionId?'<button class="btn primary" data-action="room-final-revise">提交修订版</button>':''}
    <button class="btn secondary" data-action="room-export">导出此版</button>${loading?'<span role="status">正在读取版本…</span>':''}</div>
    ${work.description?`<p class="final-focus">${esc(work.description)}</p>`:''}
    <div class="desk-columns"><section class="desk-sheet"><nav class="sheet-tabs" aria-label="作品材料">${tabs.map(([id,name])=>`<button aria-pressed="${id===active}" data-action="room-material" data-id="${esc(id)}">${esc(name)}</button>`).join('')}</nav>
    ${canCompare?`<button class="btn text" data-action="room-final-compare" data-id="${esc(file.id)}">${comparison?'关闭上一版对照':'对照上一版模型'}</button>`:''}${compare}${retry}</section>
    <aside class="desk-feedback"><nav class="work-tabs" aria-label="评阅内容">${[['teacher','教师审查'],['ai','AI 点评'],['history','提交记录']].map(([id,name])=>`<button aria-pressed="${tab===id}" data-action="room-final-tab" data-id="${id}">${name}</button>`).join('')}</nav>
    ${tab==='history'?history+`<h3>V${version.number} 修订说明</h3><p>${esc(version.note||'首次提交')}</p>`+reviewHistory:tab==='ai'?ai:
      `${reviewer?'<button class="btn primary" data-action="room-final-verdict">发布本版总评</button> <button class="btn text" data-action="room-comment" data-id="project">添加意见</button>':''}${verdicts||`<p class="work-empty">${version.number===1?'待评阅':'待复核'}</p>`}${comments}`}
    <button class="btn text" data-action="room-refresh">刷新评阅记录</button></aside></div></section>`;
}
