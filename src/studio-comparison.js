import {esc} from './materials.js';
import {compareSpaces} from '../shared/studio-preview.js';
import {areaOf,axonSvg,axonViewBox,planSvg,planMetrics,planOf,round} from '../shared/space-planning.js';
import {boundsOf} from '../shared/plan-geometry.js';

export const comparisonPrintStyle=`
  .studio-comparison-panes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;break-inside:avoid}
  .studio-comparison-panes figure{min-width:0;margin:0}
  .studio-comparison-panes svg{width:100%;height:190px;display:block}
  .studio-compare-table td,.studio-compare-table th{overflow-wrap:anywhere}`;

function planViewBox(plans){
  const boxes=plans.flatMap(plan=>plan.spaces.map(boundsOf));
  const x=Math.min(0,...boxes.map(box=>box.x))-2;
  const y=Math.min(0,...boxes.map(box=>box.y))-2;
  return [x,y,Math.max(...plans.map(plan=>plan.width),...boxes.map(box=>box.x+box.width))-x+2,
    Math.max(...plans.map(plan=>plan.depth),...boxes.map(box=>box.y+box.depth))-y+2].join(' ');
}

const name=(space,program)=>space?.label||program.find(row=>row.id===space?.programId)?.name||'空间';
const figures=m=>`布置 ${m.area} ㎡ · ${m.placed} 个空间 · 重叠 ${m.overlaps.length} 组 · 越界 ${m.outside.length} 个`;
export function optionComparison(left,right,program,relationships,{mode='plan',camera,focused,scope='compare',fileUrl,interactive=false}={}){
  const plans=[planOf(left),planOf(right)];
  const box=mode==='plan'?planViewBox(plans):axonViewBox(plans,camera);
  const pairs=compareSpaces(...plans);
  const pane=(option,index,space)=>{
    const plan=plans[index], selected=space?.id||'';
    const drawing=mode==='plan'?planSvg(plan,program,{viewBox:box,scope:scope+'-'+index,selected,fileUrl}):
      axonSvg(plan,program,{viewBox:box,camera,selected});
    return `<figure data-compare-side="${index?'right':'left'}"><figcaption>${esc(option.title)}</figcaption>
      ${drawing}<p>${figures(planMetrics(plan,program,relationships))}</p></figure>`;
  };
  const pair=pairs[focused];
  const rows=pairs.map(({before,after},i)=>{
    const cell=space=>space?esc(name(space,program))+' · '+round(areaOf(space))+' ㎡':'—';
    return `<tr><td>${cell(before)}</td><td>${cell(after)}</td><td>${before&&after?'同源':before?'仅左侧':'仅右侧'}
      ${interactive?`<button type="button" data-action="studio-compare-space" data-id="${i}" aria-pressed="${focused===i}">定位</button>`:''}</td></tr>`;
  }).join('');
  return `<div class="studio-comparison-panes">${pane(left,0,pair?.before)}${pane(right,1,pair?.after)}</div>
    ${rows?`<div class="studio-compare-table"><table><thead><tr><th>${esc(left.title)}</th><th>${esc(right.title)}</th><th>对应关系</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}`;
}

export function draftPreviewMarkup({preview,mode,run,stale,busy}){
  const {beforeMetrics:b,afterMetrics:a,changes}=preview;
  const metrics=[['面积',b.area,a.area,'㎡'],['空间',b.placed,a.placed,'个'],['缺少',b.missing,a.missing,'个'],
    ['重叠',b.overlaps.length,a.overlaps.length,'组'],['越界',b.outside.length,a.outside.length,'个']];
  return `<section class="studio-preview" data-studio-preview>
    <header><b>${run?'AI 修改预览':'对话操作预览'}</b><span>${preview.copied?'将在副本试改':'当前方案'}</span></header>
    <p>${esc(preview.summary)}</p>
    ${stale?'<p role="status">工作稿已变化，请重新发起建议。</p>':''}
    <div class="studio-preview-metrics">${metrics.map(([label,from,to,unit])=>`<span>${label} ${from} → ${to} ${unit}</span>`).join('')}</div>
    ${changes.length?`<details><summary>${changes.length} 个空间有变化 · 蓝色为修改后，红色虚线为修改前</summary>
      <ul>${changes.map(c=>`<li>${esc(c.name)} · ${c.beforeArea??'—'} → ${c.afterArea??'—'} ㎡
        ${c.before&&c.after&&c.before.height!==c.after.height?` · 高度 ${c.before.height} → ${c.after.height} m`:''}</li>`).join('')}</ul></details>`:''}
    <div class="studio-preview-actions">
      <button type="button" data-action="studio-accept-preview" ${stale||busy?'disabled':''}>${preview.copied?'采用到副本':'采用修改'}</button>
      <button type="button" data-action="studio-preview-mode" data-value="${mode==='copy'?'current':'copy'}" ${stale||busy?'disabled':''}>${mode==='copy'?'预览当前方案':'在副本试用'}</button>
      <button type="button" data-action="studio-discard-preview" ${busy?'disabled':''}>放弃</button>
    </div>
  </section>`;
}
