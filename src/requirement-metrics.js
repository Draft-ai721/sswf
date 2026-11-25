import {esc} from './materials.js';
import {boundsOf,round} from '../shared/plan-geometry.js';
import {requirementAreas} from '../shared/program-requirements.js';
import {sourceUrl} from './requirement-editor.js';

const area = n => n===null?'待确认':round(n)+' ㎡';
const delta = n => n===null?'待确认':(n>0?'+':'')+round(n)+' ㎡';

export function requirementDescription(row, files, fileUrl=sourceUrl) {
  const sizes=requirementAreas(row), source=row.spec?.source;
  const file=source&&files.find(f=>f.id===source.fileId);
  const quantity=sizes.areaBasis==='total'?`${row.count} 个 · 合计 ${area(sizes.totalM2)}`:
    `${row.count} 个 · 每个 ${area(sizes.referenceEachM2)} · 合计 ${area(sizes.totalM2)}`;
  const page=source?.page?' · 第 '+source.page+' 页':'';
  return `${quantity} · ${sizes.confirmed?'已确认':'待确认'}${source?
    `<br>${file?`<a href="${esc(fileUrl(source.fileId,source.page))}" target="_blank" rel="noopener">${esc(file.name+page)}</a>`:'来源材料不可用'+page} · 「${esc(source.quote)}」`:''}`;
}

export function requirementIssuesMarkup(issues,plan,program,prefix,selectedKey='') {
  const title=id=>{
    const space=plan.spaces.find(s=>s.id===id);
    return space?.label||program.find(r=>r.id===space?.programId)?.name||'空间';
  };
  function label(issue){
    if(issue.kind==='requirement'){
      const r=issue.requirement;
      return r.name+' · '+r.placed+'/'+r.required+' 个 · 面积差 '+delta(r.deltaArea)+(!r.confirmed?' · 待确认':'');
    }
    const names=issue.spaceIds.map(title).join(' / ');
    if(issue.kind==='overlap')return '重叠 · '+names;
    if(issue.kind==='outside')return '越界 · '+names;
    return '距离未达到'+issue.rule.kind+'目标 · '+names+' · '+issue.rule.actualDistance+' m';
  }
  return issues.length?`<div class="requirement-issues">${issues.map(issue=>
    `<button type="button" data-action="${prefix}-locate-issue" data-id="${esc(issue.key)}" aria-pressed="${issue.key===selectedKey}">${esc(label(issue))}</button>`
  ).join('')}</div>`:'<p>当前方案没有待核对的需求或几何问题。</p>';
}

export function locatedBounds(plan,ids) {
  const boxes=plan.spaces.filter(s=>ids.includes(s.id)).map(boundsOf);
  if(!boxes.length)return null;
  const x=Math.min(...boxes.map(b=>b.x)), y=Math.min(...boxes.map(b=>b.y));
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,depth:Math.max(...boxes.map(b=>b.y+b.depth))-y};
}
