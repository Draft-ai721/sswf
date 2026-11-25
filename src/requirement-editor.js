import {esc} from './materials.js';
import {requirementAreas,requirementCandidates,validateRequirementSpec} from '../shared/program-requirements.js';
import {readRequirementPage} from './studio-pdf.js';

export function sourceUrl(id,page) {
  return '/api/files/'+encodeURIComponent(id)+'?preview=1'+(page?'#page='+page:'');
}

export function requirementFields(row, files, sourceId='') {
  const spec=row.spec, source=spec?.source;
  const chosen=source?.fileId||sourceId;
  const sources=files.filter(file=>['pdf','jpg','png'].includes(file.type));
  return `<div data-requirement-fields>
    <label>名称<input name="name" required maxlength="160" value="${esc(row.name)}"></label>
    <label>数量<input name="count" type="number" required min="1" max="10000" step="1" value="${row.count||1}"></label>
    <label>面积口径<select name="areaBasis"><option value="each">每间面积</option><option value="total" ${spec?.areaBasis==='total'?'selected':''}>合计面积</option></select></label>
    <label>面积 / ㎡<input name="statedAreaM2" type="number" min="0" max="1000000" step="any" value="${spec?spec.statedAreaM2??'':row.area??''}" placeholder="待确认可留空"></label>
    <output data-requirement-total></output>
    <label><input name="confirmed" type="checkbox" ${spec?.confirmation==='confirmed'?'checked':''}>确认这条需求</label>
    <label>使用者与容量<input name="users" maxlength="1000" value="${esc(row.users)}"></label>
    <label>相邻、共享或分隔<textarea name="relation" maxlength="2000">${esc(row.relation)}</textarea></label>
    <fieldset class="requirement-source"><legend>来源</legend>
      <label>原件<select name="sourceFileId"><option value="">手工填写</option>${sources.map(file=>
        `<option value="${esc(file.id)}" ${file.id===chosen?'selected':''}>${esc(file.name)}</option>`).join('')}</select></label>
      <label data-requirement-page>PDF 页码<input name="sourcePage" type="number" min="1" max="2000" value="${source?.page||1}"></label>
      <button type="button" data-read-source>读取所选页</button>
      <a data-open-source target="_blank" rel="noopener">打开原件</a>
      <p data-source-status aria-live="polite"></p>
      <div data-source-preview></div>
      <div data-requirement-candidates></div>
      <label>原句<textarea name="sourceQuote" maxlength="1600" placeholder="从任务书摘录，扫描件可照图录入">${esc(source?.quote)}</textarea></label>
      <input type="hidden" name="sourceRegion" value="${esc(source?.region?JSON.stringify(source.region):'')}">
    </fieldset></div>`;
}

export function readRequirementForm(form,id,files) {
  const d=new FormData(form);
  const file=files.find(file=>file.id===d.get('sourceFileId'));
  const source=file?{fileId:file.id,quote:String(d.get('sourceQuote')||''),
    ...(file.type==='pdf'?{page:Number(d.get('sourcePage'))}:{}),
    ...(d.get('sourceRegion')?{region:JSON.parse(d.get('sourceRegion'))}:{})}:undefined;
  if(d.get('sourceFileId')&&!file)throw Error('材料已变化，请重新选择。');
  return {id,name:String(d.get('name')||''),count:Number(d.get('count')),
    users:String(d.get('users')||''),relation:String(d.get('relation')||''),
    spec:validateRequirementSpec({areaBasis:d.get('areaBasis'),
      statedAreaM2:d.get('statedAreaM2')===''?null:Number(d.get('statedAreaM2')),
      confirmation:d.has('confirmed')?'confirmed':'draft',source},files)};
}

function mountRegion(preview,graphic,field) {
  const stage=document.createElement('div');
  stage.className='requirement-preview';
  const mark=document.createElement('span');
  stage.append(graphic,mark);
  const clear=document.createElement('button');
  clear.type='button';clear.textContent='移除圈选';
  preview.replaceChildren(stage,clear);
  function paint(region){
    mark.hidden=!region;
    if(region)for(const [style,key] of [['left','x'],['top','y'],['width','width'],['height','height']]){
      mark.style[style]=region[key]*100+'%';
    }
  }
  const point=event=>{
    const box=stage.getBoundingClientRect();
    const limit=value=>Math.max(0,Math.min(1,value));
    return {x:limit((event.clientX-box.left)/box.width),y:limit((event.clientY-box.top)/box.height)};
  };
  let start=null;
  const region=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),
    width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
  const previous=()=>field.value?JSON.parse(field.value):null;
  stage.onpointerdown=event=>{
    if(!event.isPrimary||event.button!==0)return;
    event.preventDefault();start=point(event);stage.setPointerCapture(event.pointerId);
  };
  stage.onpointermove=event=>{if(start&&event.isPrimary)paint(region(start,point(event)))};
  stage.onpointerup=event=>{
    if(!start||!event.isPrimary)return;
    const selected=region(start,point(event));start=null;
    if(selected.width>.005&&selected.height>.005)field.value=JSON.stringify(selected);
    paint(previous());
  };
  stage.onpointercancel=stage.onlostpointercapture=()=>{start=null;paint(previous())};
  clear.onclick=()=>{field.value='';paint(null)};
  paint(previous());
}

export function mountRequirementEditor(form,files,program=[]){
  if(!form)return;
  const fields=form.elements, status=form.querySelector('[data-source-status]');
  const preview=form.querySelector('[data-source-preview]'), list=form.querySelector('[data-requirement-candidates]');
  const read=form.querySelector('[data-read-source]'), open=form.querySelector('[data-open-source]');
  let generation=0;
  const source=()=>files.find(file=>file.id===fields.sourceFileId.value);
  function updateSource(reset){
    const file=source(), pdf=file?.type==='pdf';
    form.querySelector('[data-requirement-page]').hidden=!pdf;
    fields.sourcePage.disabled=!pdf;
    read.hidden=open.hidden=!file;
    if(file)open.href=sourceUrl(file.id,pdf?Number(fields.sourcePage.value):0);
    if(reset){generation++;fields.sourceRegion.value='';fields.sourceQuote.value='';preview.replaceChildren();list.replaceChildren();status.textContent='';read.disabled=false}
  }
  const updateTotal=()=>{
    const {totalM2}=requirementAreas({count:Number(fields.count.value),
      spec:{areaBasis:fields.areaBasis.value,statedAreaM2:fields.statedAreaM2.value===''?null:Number(fields.statedAreaM2.value)}});
    form.querySelector('[data-requirement-total]').textContent=totalM2===null?'面积待确认':'需求合计 '+Number(totalM2.toFixed(2))+' ㎡';
  };
  for(const name of ['count','areaBasis','statedAreaM2'])fields[name].addEventListener('input',updateTotal);
  for(const name of ['sourcePage','sourceFileId'])fields[name].addEventListener('change',()=>updateSource(true));
  read.onclick=async()=>{
    const file=source(), page=Number(fields.sourcePage.value);
    if(!file)return;
    if(file.type==='pdf'&&(!Number.isInteger(page)||page<1||page>2000)){status.textContent='请输入有效页码。';return}
    const stamp=++generation;
    read.disabled=true;status.textContent='正在读取原件…';preview.replaceChildren();list.replaceChildren();
    try{
      let graphic,text='';
      if(file.type==='pdf')({canvas:graphic,text}=await readRequirementPage(sourceUrl(file.id),page));
      else{graphic=new Image();graphic.alt='需求原件';graphic.src=sourceUrl(file.id);await graphic.decode()}
      if(stamp!==generation||!form.isConnected)return;
      mountRegion(preview,graphic,fields.sourceRegion);
      const candidates=requirementCandidates(text);
      status.textContent=(candidates.length?'请选择一条候选并核对。':'可手工摘录原句。')+' 可拖动圈选原件区域。';
      if(text.trim()){
        const excerpt=document.createElement('textarea');
        excerpt.readOnly=true;excerpt.rows=3;excerpt.value=text;
        excerpt.setAttribute('aria-label','本页提取文字');
        const copy=document.createElement('button');copy.type='button';copy.textContent='引用选中文字';
        copy.onclick=()=>{
          const selected=text.slice(excerpt.selectionStart,excerpt.selectionEnd).trim();
          if(selected){fields.sourceQuote.value=selected.slice(0,1600);fields.confirmed.checked=false}
        };
        list.append(excerpt,copy);
      }
      for(const candidate of candidates){
        const button=document.createElement('button');
        button.type='button';button.textContent=candidate.quote;
        function useCandidate(){
          for(const key of ['name','count','areaBasis','statedAreaM2'])fields[key].value=candidate[key];
          fields.sourceQuote.value=candidate.quote;fields.confirmed.checked=false;updateTotal();
        }
        button.onclick=useCandidate;
        list.append(button);
        if(form.dataset.id)continue;
        const matches=program.filter(row=>{
          const original=row.spec?.source;
          return original?.fileId===file.id&&original.page===page&&
            (original.quote===candidate.quote||row.name.toLowerCase()===candidate.name.toLowerCase());
        });
        for(const row of matches){
          const before=requirementAreas(row);
          const next=requirementAreas({count:candidate.count,spec:candidate});
          const comparison=document.createElement('p');
          const size=n=>n===null?'待确认':Number(n.toFixed(2))+' ㎡';
          comparison.textContent=`已有 ${row.name} · ${row.count} 个 / ${size(before.totalM2)} → ${candidate.count} 个 / ${size(next.totalM2)}`;
          const update=document.createElement('button');
          update.type='button';update.textContent='更新已有条目：'+row.name;
          update.onclick=()=>{
            form.dataset.id=row.id;
            fields.users.value=row.users||'';fields.relation.value=row.relation||'';
            if(!fields.sourceRegion.value&&row.spec.source.region){
              fields.sourceRegion.value=JSON.stringify(row.spec.source.region);
              mountRegion(preview,graphic,fields.sourceRegion);
            }
            useCandidate();
            status.textContent='正在编辑已有条目。核对后保存，已关联空间会保留。';
          };
          list.append(comparison,update);
        }
      }
    }catch(error){if(stamp===generation)status.textContent='读取失败。可以打开原件并手工录入。'+error.message}
    finally{if(stamp===generation)read.disabled=false}
  };
  updateSource(false);updateTotal();
}
