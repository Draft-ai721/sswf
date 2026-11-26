import {esc} from './materials.js';

const isRecord=entry=>entry.role==='notice';

// Preserve the first requirement and the latest conversation before allocating slots to canvas records.
export function retainStudioHistory(rows,limit=80){
  if(limit<=0)return [];
  if(rows.length<=limit)return rows;
  const dialogue=rows.filter(entry=>!isRecord(entry));
  const first=dialogue.find(entry=>entry.role==='user');
  const dialogueSlots=limit-Number(Boolean(first));
  const kept=dialogueSlots?dialogue.slice(-dialogueSlots):[];
  if(first&&!kept.includes(first))kept.unshift(first);
  const selected=new Set(kept);
  const slots=limit-selected.size;
  if(slots>0)rows.filter(isRecord).slice(-slots).forEach(entry=>selected.add(entry));
  return rows.filter(entry=>selected.has(entry));
}

export function studioHistoryMarkup(rows,expanded){
  const first=rows.find(entry=>entry.role==='user');
  const message=entry=>`<article class="studio-message ${esc(entry.role)}" data-source="${esc(entry.source)}"${entry===first?' data-first-requirement tabindex="-1"':''}>
    <small>${entry.role==='user'?'你':entry.role==='notice'?'画布记录':entry.source==='model'?'AI 建议':'助手'}</small>
    <p>${esc(entry.text)}</p>${entry.runId?`<button data-action="studio-run" data-id="${esc(entry.runId)}">原始依据与操作 ↗</button>`:''}</article>`;
  const blocks=[];
  let group='intro', records=[];
  const flush=()=>{
    if(!records.length)return;
    blocks.push(`<details class="studio-canvas-history" data-canvas-history="${esc(group)}"${expanded.has(group)?' open':''}>
      <summary>画布记录 <span>${records.length} 条</span></summary>${records.map(message).join('')}</details>`);
    records=[];
  };
  for(const entry of rows){
    if(isRecord(entry))records.push(entry);
    else{flush();blocks.push(message(entry));group=entry.id}
  }
  flush();
  return blocks.join('');
}

export function restoreStudioScroll(log,scroll){
  if(log)log.scrollTop=scroll?.follow===false?scroll.top:log.scrollHeight;
}
