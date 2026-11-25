import {coverageText,finalVersionUrl} from './final-review.js';
import {readRequirementPage} from './studio-pdf.js';
import {esc} from './materials.js';
import {planSvg,axonSvg} from '../shared/space-planning.js';

const date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const text=value=>esc(value||'').replace(/\n/g,'<br>');
const image=data=>typeof data==='string'&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)?data:null;
const notes=(heading,rows)=>rows?.length?`<h3>${heading}</h3><ul>${rows.map(row=>`<li>${text(row)}</li>`).join('')}</ul>`:'';

export function finalArchiveHtml(room,figures=[],capturedAt=new Date().toISOString()){
  const v=room.version,work=v.snapshot,ai=room.aiReview;
  const source=id=>work.files.find(file=>file.id===id)?.name||'作品整体';
  const drawing=work.drawing;
  const rendered=figures.map(({caption,data})=>image(data)?`<figure><img src="${data}" alt="${esc(caption)}"><figcaption>${esc(caption)}</figcaption></figure>`:
    `<p class="meta">${esc(caption)}</p>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(room.title)} · 终评 V${v.number}</title><style>
  body{color:#29372a;background:#eef1e9;font:15px/1.7 system-ui,sans-serif;margin:0}.archive{max-width:900px;margin:32px auto;padding:44px;background:white}
  h1,h2,h3{line-height:1.3}h2{border-bottom:1px solid #dfe5d8;padding-bottom:8px;margin-top:30px}.meta,figcaption,small{color:#576951}
  article,figure{break-inside:avoid;margin:14px 0;padding:14px;border:1px solid #dfe5d8}img,svg{max-width:100%;max-height:680px;display:block;margin:auto}
  blockquote{border-left:3px solid #bcccae;padding-left:12px;margin:12px 0}@page{size:A4;margin:16mm}@media print{body{background:white}.archive{margin:0;padding:0}h2{break-after:avoid}}
  </style></head><body><main class="archive"><p class="meta">最终评审 · 作品档案</p><h1>${esc(room.title)} · V${v.number}</h1>
  <p class="meta">${esc(v.label)} · 提交于 ${date(v.createdAt)}<br>版本编号 ${esc(v.id)} · 导出于 ${date(capturedAt)}</p>
  ${v.note?`<h2>修订说明</h2><p>${text(v.note)}</p>`:''}${work.description?`<h2>设计说明</h2><p>${text(work.description)}</p>`:''}
  <h2>本版材料</h2>${notes('原件清单',work.files.map(file=>file.name))}
  ${drawing?`<h3>${esc(drawing.title)}</h3>${planSvg(drawing.plan,drawing.program)}${axonSvg(drawing.plan,drawing.program)}`:''}${rendered}
  <h2>教师审查</h2>${(room.verdictHistory||room.verdicts).map(row=>`<article><small>${esc(row.author)} · ${date(row.createdAt)}</small><h3>${esc(row.decision)}</h3><p>${text(row.text)}</p></article>`).join('')||'<p>此版暂无教师总评。</p>'}
  <h3>定位意见与回应</h3>${room.comments.map((row,index)=>`<article><small>意见 ${index+1} · ${esc(row.authorName||row.author)} · ${date(row.createdAt)} · ${esc(row.status)}</small>
  <h3>${esc(source(row.source))}${row.imagePoint?.page?' · 第 '+row.imagePoint.page+' 页':''}${row.point?' · 模型表面':''}</h3><p>${text(row.text)}</p>
  ${row.task?`<p>修改任务 ${text(row.task)}</p>`:''}${row.replies.map(reply=>`<blockquote><small>学生回应 · ${date(reply.createdAt)}</small><p>${text(reply.text)}</p>${notes('补交材料',(reply.files||[]).map(file=>file.name))}</blockquote>`).join('')}
  ${row.events?.length?`<small>${row.events.map(event=>`${date(event.at)} · ${esc(event.role)} · ${esc(event.status)}`).join('<br>')}</small>`:''}</article>`).join('')||'<p>此版暂无定位意见。</p>'}
  <h2>AI 点评</h2>${ai?`<p class="meta">${esc(ai.provider)} · ${esc(ai.model)} · ${date(ai.createdAt)}</p><p>${text(ai.summary)}</p>
  ${notes('材料读取范围',ai.coverage.map(row=>row.name+' · '+coverageText(row)))}${notes('已有依据的优点',ai.strengths)}${notes('还需补充的材料',ai.missingMaterials)}
  ${ai.comments.map(c=>`<article><small>${esc(c.location)} · ${esc(c.kind)}</small><h3>${esc(c.title)}</h3>${c.quote?`<blockquote>${text(c.quote)}</blockquote>`:''}
  <p>${text(c.evidence)}</p>${c.need?`<p>待补充 ${text(c.need)}</p>`:''}<p>建议 ${text(c.suggestion)}</p>${c.question?`<p>追问 ${text(c.question)}</p>`:''}</article>`).join('')}
  ${notes('可供教师选择的追问',ai.teacherQuestions)}`:'<p>此版暂无 AI 点评。</p>'}</main></body></html>`;
}

function drawPins(canvas,points){
  const ctx=canvas.getContext('2d'),size=Math.max(11,canvas.width*.013);
  for(const row of points.filter(row=>row.imagePoint)){
    const x=row.imagePoint.x*canvas.width,y=row.imagePoint.y*canvas.height;
    ctx.beginPath();ctx.arc(x,y,size,0,2*Math.PI);ctx.fillStyle='#a33e2d';ctx.fill();
    ctx.fillStyle='white';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${size}px sans-serif`;ctx.fillText(row.index+1,x,y);
  }
}

async function imagePreview(url,points=[]){
  const response=await fetch(url);
  if(!response.ok)throw Error('无法读取此版证据。');
  const bitmap=await createImageBitmap(await response.blob());
  try{
    const canvas=document.createElement('canvas'),scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    drawPins(canvas,points);
    return canvas.toDataURL('image/jpeg',.8);
  }finally{bitmap.close()}
}

export async function downloadFinalReport(room,currentModel){
  const endpoint=finalVersionUrl(room),figures=[];
  const capture=async(caption,read)=>{
    try{figures.push({caption,data:await read()})}catch{figures.push({caption:caption+' · 预览未能嵌入，可从评阅页重试'})}
  };
  for(const file of room.version.snapshot.files){
    const href=endpoint+'/files/'+file.id;
    const points=room.comments.map((row,index)=>({...row,index})).filter(row=>row.source===file.id);
    if(file.type==='pdf'){
      const cited=room.aiReview?.comments.filter(c=>c.fileId===file.id&&c.page).map(c=>c.page)||[];
      const pages=[...new Set([1,...points.map(row=>row.imagePoint?.page).filter(Boolean),...cited])];
      for(const page of pages.slice(0,5))await capture(file.name+' · 第 '+page+' 页',async()=>{
        const {canvas}=await readRequirementPage(href,page);
        drawPins(canvas,points.filter(row=>row.imagePoint?.page===page));
        return canvas.toDataURL('image/jpeg',.8);
      });
      if(pages.length>5)figures.push({caption:file.name+' · 档案内嵌前 5 个关键页，其余页可在评阅页打开。'});
    }else if(['jpg','png'].includes(file.type))await capture(file.name,()=>imagePreview(href,points));
    else if(file.type==='skp'){
      const refs=points.filter(row=>row.point?.imageId).slice(0,5);
      for(const row of refs)await capture(file.name+' · 教师意见 '+(row.index+1)+' 的视角',()=>imagePreview(endpoint+'/evidence/'+row.point.imageId));
      const result=room.aiReview,views=result?.coverage.find(row=>row.fileId===file.id)?.modelViews||[];
      for(const view of views)await capture(file.name+' · AI 输入 · '+view.label,()=>imagePreview(endpoint+'/ai-views/'+result.id+'/'+view.id));
      if(!refs.length&&!views.length){
        if(currentModel?.fileId===file.id&&image(currentModel.thumbnail))figures.push({caption:file.name+' · 导出时的模型视角',data:currentModel.thumbnail});
        else figures.push({caption:file.name+' · 本次档案没有已保存的静态视角'});
      }
    }
  }
  const url=URL.createObjectURL(new Blob([finalArchiveHtml(room,figures)],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=room.title+'-V'+room.version.number+'-终评档案.html';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
