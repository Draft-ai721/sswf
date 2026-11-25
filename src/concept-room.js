import {esc} from './materials.js';
import {planSvg,axonSvg,axonProjection} from '../shared/space-planning.js';

export const decisions={adopt:'采纳',partial:'部分采纳',defer:'暂缓',retain:'保留原方案'};
export const revisionBase=room=>'/api/review-rooms/'+room.id+
  (room.revisionSelected?'/versions/'+room.version.id:'');

export function taskLabels(summary){
  return Object.entries(summary?.counts||{}).filter(([,count])=>count)
    .map(([name,count])=>`<span class="tag gold">${esc(name)} ${count}</span>`).join(' ');
}

function discussionCard(c,r){
  const version=r.versions?.find(v=>v.id===(c.versionId||r.versions[0]?.id));
  const bound=c.anchor?.kind==='plan'?'平面定位':c.anchor?.kind==='mass'?'体块定位':c.point?'模型定位':c.imagePoint?'图纸定位':'查看原处';
  const versionLabel=v=>v?'V'+v.number+' · '+v.label:'共享版本';
  return `<article class="room-comment" id="room-question-${esc(c.id)}">
    <div class="row between"><span class="tag ${c.status==='已完成'?'blue':'gold'}">${esc(c.status)}</span><small>${esc(c.kind)}</small></div>
    <button class="btn text room-location" data-action="room-locate" data-id="${esc(c.id)}">${esc(versionLabel(version))} · ${bound} ↗</button>
    <h3>${esc(c.text)}</h3>${c.task?`<p><b>修改任务：</b>${esc(c.task)}</p>`:''}
    <small>${esc(c.authorName||c.author)}${c.authorName?' · '+esc(c.author):''}</small>
    ${c.replies.map(reply=>{
      const revision=r.versions?.find(v=>v.id===reply.responseVersionId);
      return `<div class="response-summary"><b>学生回应${reply.decision?' · '+esc(decisions[reply.decision]):''}</b>
        <p>${esc(reply.text)}</p>${revision?`<button class="btn text" data-action="room-locate-reply" data-id="${esc(c.id)}" data-reply="${esc(reply.id)}">查看改后 ${esc(versionLabel(revision))} ↗</button>`:''}</div>`;
    }).join('')}
    ${c.events?.length?`<details class="review-events"><summary>处理记录</summary>${c.events.map(event=>`<p>${esc(event.role)} · ${esc(event.status)} · ${new Date(event.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>`).join('')}</details>`:''}
    ${r.role==='owner'?`<button class="btn secondary small" data-action="room-reply" data-id="${esc(c.id)}">回应与附上改稿</button>`:
      c.canResolve&&c.status==='待复核'?`<div class="row"><button class="btn text" data-action="room-resolve" data-id="${esc(c.id)}" data-status="继续修改">继续修改</button>
      <button class="btn text" data-action="room-resolve" data-id="${esc(c.id)}" data-status="已完成">复核完成</button></div>`:''}
  </article>`;
}

export function conceptDesk(r,{selected,filter,report,material,canvas,invites,loading}){
  const v=r.version,p=v.snapshot;
  const filters=[['all','全部'],['open','未解决'],['待复核','待复核'],['已完成','已完成']];
  const show=(comment,value)=>value==='all'||value==='open'&&comment.status!=='已完成'||comment.status===value;
  const tab=(id,label)=>`<button class="btn ${selected===id?'primary':'secondary'} small" data-action="room-material" data-id="${esc(id)}">${esc(label)}</button>`;
  return `<div class="page-heading"><div><a href="#/collaboration" class="muted">← 概念讨论</a>
    <h1>${esc(r.title)}</h1><p>${esc(r.course?.name)} · V${v.number} · ${esc(v.label)}</p></div>
    <div class="row"><button class="btn secondary" data-action="room-refresh">刷新讨论</button>
    <button class="btn secondary" data-action="room-export">导出评审报告</button></div></div>
    <div class="room-version-toolbar row"><label>共享版本 <select id="room-concept-version" ${loading?'disabled':''}>
      ${(r.versions||[]).map(row=>`<option value="${esc(row.id)}" ${row.id===v.id?'selected':''}>V${row.number} · ${esc(row.label)}</option>`).join('')}</select></label>
      ${r.role==='owner'?'<button class="btn secondary" data-action="room-share-revision">共享改后版本</button>':''}
      ${loading?'<span role="status">正在读取共享版本…</span>':''}</div>
    <div class="shared-review-layout"><section class="panel">
    <div class="room-material-tabs">${tab('report','汇报与背景')}${p.workflow?.options?.length?tab('concept-plan','平面与体块'):''}
    ${p.files.map(f=>tab(f.id,f.name)).join('')}</div>
    ${selected==='report'?report:selected==='concept-plan'?canvas:material}
    ${r.role==='reviewer'?'<button class="btn primary" data-action="room-comment" data-id="project">添加总体问题</button>':''}</section>
    <aside><section class="panel"><h2>围绕作品的讨论 <small>${r.comments.length}</small></h2>
    ${taskLabels(r.taskSummary)} ${r.taskSummary?.unread?`<button class="btn text" data-action="room-read-tasks">${r.taskSummary.unread} 条未读 · 标为已读</button>`:''}
    <div class="room-review-stats">${filters.map(([value,label])=>`<button class="${value===filter?'active':''}" data-action="room-review-filter" data-value="${value}">${label}<b>${r.comments.filter(c=>show(c,value)).length}</b></button>`).join('')}</div>
    ${r.comments.filter(c=>show(c,filter)).map(c=>discussionCard(c,r)).join('')||'<p class="muted">此处暂无讨论。</p>'}</section>
    ${r.role==='owner'?invites:''}</aside></div>`;
}

export function conceptDrawing(r,{optionId,mode,camera,anchor}){
  const w=r.version.snapshot.workflow;
  const option=w?.options.find(row=>row.id===optionId)||w?.options[0];
  if(!option?.plan)return '<p>此版本没有可预览的布局。</p>';
  const focused=anchor?.optionId===option.id&&anchor.kind===mode?anchor:null;
  const options={interactive:true,selected:focused?.spaceId||'',viewBox:focused?.view.viewBox.join(' '),camera,
    fileUrl:id=>revisionBase(r)+'/files/'+id};
  let drawing=mode==='mass'?axonSvg(option.plan,w.program,options):planSvg(option.plan,w.program,{...options,scope:'room-'+r.version.id});
  if(focused){
    const [x,y]=mode==='mass'?axonProjection(camera)(...focused.xyz):focused.xy;
    const radius=focused.view.viewBox[2]*.009;
    drawing=drawing.replace('</svg>',`<circle data-room-anchor-pin cx="${x}" cy="${y}" r="${radius}" fill="#d65c42" stroke="white" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/></svg>`);
  }
  return `<div class="room-concept-toolbar row"><label>方案 <select id="room-concept-option">${w.options.map(o=>
    `<option value="${esc(o.id)}" ${option.id===o.id?'selected':''}>${esc(o.title)}</option>`).join('')}</select></label>
    <button class="btn secondary small" data-action="room-concept-mode" data-value="plan" aria-pressed="${mode==='plan'}">平面</button>
    <button class="btn secondary small" data-action="room-concept-mode" data-value="mass" aria-pressed="${mode==='mass'}">体块</button>
    ${mode==='mass'?'<button class="btn secondary small" data-action="room-concept-turn" data-value="-1">左转</button><button class="btn secondary small" data-action="room-concept-turn" data-value="1">右转</button>':''}</div>
    ${r.role==='reviewer'?`<p class="muted">${mode==='mass'?'点击顶面或地面定位提问。':'点击平面位置提问。'}</p>`:''}
    <div class="room-concept-canvas" data-room-concept-canvas data-option="${esc(option.id)}">${drawing}</div>`;
}

export function pointOnConceptDrawing(event,element,room,mode,camera){
  const svg=element.querySelector('svg');
  const transform=svg.getScreenCTM();
  if(!transform)return null;
  const {x,y}=new DOMPoint(event.clientX,event.clientY).matrixTransform(transform.inverse());
  const plan=room.version.snapshot.workflow.options.find(option=>option.id===element.dataset.option).plan;
  const viewBox=svg.getAttribute('viewBox').trim().split(/\s+/).map(Number);
  const base={versionId:room.version.id,optionId:element.dataset.option};
  if(mode==='plan'){
    const spaceId=event.target.closest('[data-space-id]')?.dataset.spaceId;
    return {...base,kind:'plan',...(spaceId?{spaceId}:{}),xy:[x,y],view:{viewBox}};
  }
  const solid=event.target.closest('[data-solid]');
  if(solid&&!event.target.closest('[data-roof]'))return null;
  const spaceId=solid?.dataset.solid,height=plan.spaces.find(s=>s.id===spaceId)?.height||0;
  const project=axonProjection(camera);
  const [ox,oy]=project(0,0,height),[xx,xy]=project(1,0,height),[yx,yy]=project(0,1,height);
  const ax=xx-ox,ay=xy-oy,bx=yx-ox,by=yy-oy,det=ax*by-ay*bx;
  const px=((x-ox)*by-(y-oy)*bx)/det,py=(ax*(y-oy)-ay*(x-ox))/det;
  return {...base,kind:'mass',...(spaceId?{spaceId}:{}),xyz:[px,py,height],view:{viewBox,camera}};
}
