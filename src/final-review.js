import {pdfSheet} from './final-pdf.js';
import {esc} from './materials.js';
import {extractTaskText,reviewCover} from './studio-pdf.js';
import {planSvg,axonSvg} from '../shared/space-planning.js';

export function submissionPage(projects, guest) {
  if(guest)return '<section class="work-page"><h1>提交作品</h1><a class="btn primary" href="/login?return_to=%2F%23%2Ffinal-new">登录后上传</a></section>';
  const options=[];
  for(const project of projects) for(const version of project.versions) for(const option of version.snapshot.workflow?.options||[]) {
    if(option.plan)options.push(`<option value="${esc(JSON.stringify([project.id,version.id,option.id]))}">${esc(project.name)} · V${version.number} · ${esc(option.title)}</option>`);
  }
  return `<section class="work-page submit-page"><a class="back-link" href="#/finals">← 最终评审</a><h1>提交作品</h1>
    <form id="final-submit-form" class="submission-form">
    <fieldset><legend>作品材料</legend><label class="file-pick">选择展板或图纸<input type="file" name="files" accept=".pdf,.jpg,.jpeg,.png" multiple><small>PDF、JPG、PNG · 最多 3 份，每份 20 MB</small></label>
    ${options.length?`<details><summary>从概念生成导入</summary><label>只导入所选方案的平面和体块<select name="source"><option value="">使用上传的材料</option>${options.join('')}</select></label></details>`:''}</fieldset>
    <fieldset><legend>作品信息</legend><label>作品名称<input name="title" required maxlength="100"></label><label>设计说明或希望评阅的问题（选填）<textarea name="focus" rows="5" maxlength="3000"></textarea></label>
    <small>提交后可以单独请求 AI 点评，或邀请老师审查。</small><button class="btn primary" type="submit">提交并查看作品</button><output aria-live="polite"></output></fieldset></form></section>`;
}
export async function uploadFinalFiles(files,api,status,cache=new Map()) {
  if(!files.length||files.length>3)throw Error('请选择一至三份作品材料。');
  for(const file of files)if(!/\.(pdf|jpe?g|png)$/i.test(file.name)||file.size>20*1024*1024||!file.size)throw Error('请选择有效的 PDF、JPG 或 PNG，每份最多 20 MB。');
  const result=[];
  for(const file of files){
    if(!cache.has(file)){
      status('正在上传 '+file.name);
      const {file:stored}=await api('/api/final-files?name='+encodeURIComponent(file.name),{method:'POST',body:file});
      let extractedText='';
      if(stored.type==='pdf'){try{extractedText=await extractTaskText(file)}catch{/* The original remains available to the reviewer. */}}
      let previewId=null;
      if(stored.type==='pdf'){
        try{
          const cover=await reviewCover(file);
          if(cover){const sample=await api('/api/final-files?name=cover.jpg&parentId='+stored.id+'&page=1',{method:'POST',body:cover});previewId=sample.file.id}
        }catch{/* Reviewers can still read the full original. */}
      }
      cache.set(file,{id:stored.id,extractedText,previewId});
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
export function finalList(list,tab) {
  const rows=list.filter(r=>r.kind==='final' && (tab==='received'?r.role!=='owner':r.role==='owner'));
  return `<section class="work-page"><div class="work-heading"><h1>最终评审</h1><a class="btn primary" href="#/final-new">＋ 提交作品</a></div>
    <nav class="work-tabs" aria-label="评审范围">${[['mine','我提交的'],['received','邀请我评阅的']].map(([key,name])=>`<a href="#/finals/${key}" ${tab===key?'aria-current="page"':''}>${name}</a>`).join('')}</nav>
    ${rows.map(r=>`<a class="work-row" href="#/final/${esc(r.id)}"><strong>${esc(r.title)}</strong><small>${esc(r.verdict||'待评阅')}</small><span>→</span></a>`).join('')||`<p class="work-empty">${tab==='mine'?'还没有提交作品。可以直接上传已有展板。':'接受老师评阅邀请后，作品会显示在这里。'}</p>`}</section>`;
}
export function finalDesk(room,{selected,tab,material,aiBusy,pdfPage}) {
  const work=room.version.snapshot, owner=room.role==='owner', reviewer=room.role==='reviewer';
  const file=work.files.find(f=>f.id===selected)||work.files[0];
  const drawing=work.drawing;
  const evidence=drawing ? (selected==='axon'?axonSvg(drawing.plan,drawing.program):planSvg(drawing.plan,drawing.program)) : file?.type==='pdf'?pdfSheet(room,file,pdfPage):file?material(room,file):'';
  const tabs=drawing?[['plan','平面'],['axon','体块']]:work.files.map(f=>[f.id,f.name]);
  const active=drawing?(selected==='axon'?'axon':'plan'):file?.id;
  const comments=room.comments.map(c=>`<article class="evaluation"><small>${esc(c.authorName||c.author)} · ${esc(c.status)}</small>
    <button class="location" data-action="room-locate" data-id="${esc(c.id)}">${esc(work.files.find(f=>f.id===c.source)?.name||'整件作品')}${c.imagePoint?.page?' · 第 '+c.imagePoint.page+' 页':''} ↗</button><p>${esc(c.text)}</p>${c.task?`<p>${esc(c.task)}</p>`:''}
    ${c.replies.map(r=>`<blockquote>${esc(r.text)}${(r.files||[]).map(f=>`<a href="/api/review-rooms/${room.id}/files/${f.id}" target="_blank" rel="noopener">补交 · ${esc(f.name)} ↗</a>`).join('')}</blockquote>`).join('')}
    ${owner?`<button class="btn text" data-action="room-reply" data-id="${c.id}">回应与补交</button>`:reviewer?`<button class="btn text" data-action="room-resolve" data-id="${c.id}" data-status="已完成">复核完成</button>`:''}</article>`).join('');
  const verdicts=(room.verdicts||[]).map(v=>`<article class="evaluation"><small>${esc(v.author)} · ${esc(v.decision)}</small><p>${esc(v.text)}</p></article>`).join('');
  const result=room.aiReview;
  const ai=result?`<small>${esc(result.provider)} · ${esc(result.model)}</small>${result.comments.map(c=>`<article class="evaluation"><h3>${esc(c.title)}</h3><p>${esc(c.evidence)}</p><p>${esc(c.suggestion)}</p>${c.fileId?`<button class="btn text" data-action="room-material" data-id="${esc(c.fileId)}">${esc(c.location)} ↗</button>`:`<small>${esc(c.location)}</small>`}</article>`).join('')}`:`<p class="work-empty">尚无 AI 点评。支持图像的模型可参考展板图像或 PDF 首页；PDF 文字最多提取前十页。</p>${owner?`<button class="btn secondary" data-action="room-final-ai" ${aiBusy?'disabled':''}>${aiBusy?'正在生成…':'生成 AI 点评'}</button>`:''}`;
  return `<section class="final-desk"><a class="back-link" href="#/finals">← 最终评审</a><div class="work-heading"><h1>${esc(room.title)}</h1>${owner?'<button class="btn secondary" data-action="room-final-invite">邀请老师</button>':''}</div>
    ${work.description?`<p class="final-focus">${esc(work.description)}</p>`:''}
    <div class="desk-columns"><section class="desk-sheet"><nav class="sheet-tabs" aria-label="作品材料">${tabs.map(([id,name])=>`<button aria-pressed="${id===active}" data-action="room-material" data-id="${esc(id)}">${esc(name)}</button>`).join('')}</nav>${evidence}</section>
    <aside class="desk-feedback"><nav class="work-tabs" aria-label="点评来源">${[['teacher','教师审查'],['ai','AI 点评']].map(([id,name])=>`<button aria-pressed="${tab===id}" data-action="room-final-tab" data-id="${id}">${name}</button>`).join('')}</nav>
    ${tab==='ai'?ai:`${reviewer?'<button class="btn primary" data-action="room-final-verdict">发布总评</button> <button class="btn text" data-action="room-comment" data-id="project">添加意见</button>':''}${verdicts||'<p class="work-empty">老师发布总评后会显示在这里。</p>'}${comments}`}
    <button class="btn text" data-action="room-refresh">刷新评阅记录</button></aside></div></section>`;
}
