import {mountPen,mountExtrusion,mountStrokeSelection} from './canvas-gestures.js';
import {icon} from './data.js';
import {DESIGN_STAGES,workflowOf} from '../shared/design-workflow.js';
import {planOf,planMetrics,planSvg,axonSvg,round,areaOf} from '../shared/space-planning.js';
import {boundsOf,footprintOf,isPolygon,MAX_VERTICES} from '../shared/plan-geometry.js';
import {prepareStudio,studioOption,applyStudioActions,captureDraft,DraftHistory,localStudioIntent} from '../shared/studio-actions.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(a,label,extra='')=>`<button type="button" data-action="studio-${a}" ${extra}>${label}</button>`;
export function createStudio({project,projects,api,save,etag,updateProject,replaceState,changed,render,toast,getStatus,isReady,quickCreate,upload,showRun}){
 let drawing=null, pen=false, selectedStroke='';
 let activeProject='',activeOption='',selected='',drawer='',view='plan',mobile='canvas',draft='',busy=false,uploading=false,highlight=false,cleanup=null,zoom=1,panX=0,panY=0,attached=new Map(),queue=Promise.resolve();const histories=new Map();
 const history=()=>{const id=project()?.id;if(!histories.has(id))histories.set(id,new DraftHistory());return histories.get(id)};
 const files=()=>{const id=project()?.id;if(!attached.has(id))attached.set(id,new Set());return attached.get(id)};
 const currentOption=()=>studioOption(project(),activeOption);
 const selection=()=>({optionId:currentOption()?.id||'',spaceIds:selected?[selected]:[]});
 function log(role,text,runId='',source='local'){const p=project();if(!p?.workflow)return;const items=p.workflow.assistantLog??=[];items.push({id:crypto.randomUUID(),role,text:String(text).slice(0,2400),runId,optionId:currentOption()?.id||'',source,createdAt:new Date().toISOString()});p.workflow.assistantLog=items.slice(-80);changed()}
 async function ensure(){if(!isReady())throw Error('请先登录，保存项目并使用 AI。');if(!project()?.workflow?.options.length){updateProject(prepareStudio(project()));activeOption=project().workflow.options[0].id;await save()}return currentOption()}
 async function mutate(actions,label='设计修改',announce=false,onApply){const projectId=project().id,captured=selection();return queue=queue.catch(()=>{}).then(async()=>{if(project()?.id!==projectId)throw Error('项目已切换，未执行这项操作。');if(!isReady())throw Error('请先登录，保存项目并使用 AI。');const before=captureDraft(project()),result=applyStudioActions(project(),actions,{optionId:captured.optionId||activeOption,spaceIds:captured.spaceIds});updateProject(result.project);onApply?.();activeOption=result.optionId;if(actions.some(action=>['stroke_to_space','delete_stroke','duplicate_option','add_space','add_polygon'].includes(action.type)))selectedStroke='';selected=result.createdIds.at(-1)||result.changedIds.filter(id=>studioOption(project(),activeOption)?.plan.spaces.some(s=>s.id===id)).at(-1)||'';history().record(before,captureDraft(project()),label);if(!actions.every(action=>action.type==='draw_stroke'))log('notice',result.summary);if(announce)mobile='canvas';if(activeOption!==captured.optionId)location.hash='#/studio/'+projectId+'/'+activeOption;try{await save()}finally{render()}return result})}
 async function step(redo=false){if(busy)return toast('请等待当前 AI 请求结束，再撤销或重做。');const result=history().step(project(),redo);if(!result)return;updateProject(result.project);selected='';selectedStroke='';activeOption=studioOption(project(),activeOption)?.id||'';log('notice',(redo?'重做：':'撤销：')+result.label);try{await save()}finally{render()}}
 function page(requested){const p=project();if(!p)return `<div class="studio-no-project"><h1>开始一次新的共创</h1>${button('new-project','新建项目')}</div>`;if(activeProject!==p.id){activeProject=p.id;activeOption='';drawing=null;pen=false;selected='';drawer='';draft='';mobile='canvas';zoom=1;panX=0;panY=0}const w=workflowOf(p),o=studioOption(p,requested||activeOption);activeOption=o?.id||'';if(drawing&&drawing.optionId!==activeOption)drawing=null;const plan=planOf(o),space=plan.spaces.find(s=>s.id===selected);if(!space)selected='';const stroke=plan.strokes?.find(s=>s.id===selectedStroke);if(!stroke)selectedStroke='';const polygon=space&&isPolygon(space);const metrics=planMetrics(plan,w.program,w.relationships||[]),status=getStatus(),rows=w.assistantLog||[],label=s=>s.label||w.program.find(p=>p.id===s.programId)?.name||'空间';return `<div class="studio" data-mobile="${mobile}" data-drawer="${drawer? 'open':'closed'}"><header class="studio-header"><a class="studio-brand" href="#/projects" title="返回项目">${icon('cube')}<b>共创</b></a><input class="studio-project-name" id="studio-project-name" aria-label="项目名称" value="${esc(p.name)}" maxlength="100"><span class="save-status"></span><div class="studio-header-actions">${button('undo',icon('history')+'<span>撤销</span>',history().undoStack.length?'':'disabled')}${button('redo','↪<span>重做</span>',history().redoStack.length?'':'disabled')}${button('drawer','材料','data-panel="materials"')}${button('drawer','过程','data-panel="process"')}${button('drawer','讨论','data-panel="discussion"')}<button class="studio-share" data-action="studio-drawer" data-panel="share">${icon('chat')}邀请评审</button><a href="${isReady()?'/account':'/login'}">${isReady()?'账号':'登录'}</a></div></header><div class="studio-conflict" data-save-conflict hidden role="alert"><span></span><button type="button" class="draft-download" data-action="download-draft">下载未保存草稿</button></div><div class="studio-mobile-tabs">${button('mobile','画布','data-value="canvas"')}${button('mobile','AI 助手','data-value="chat"')}${button('drawer','属性 / 材料','data-panel="properties"')}</div><div class="studio-body"><aside class="studio-assistant"><div class="studio-assistant-title"><span>${icon('spark')}设计助手</span><small>${busy?'正在理解…':status.configured?'DeepSeek · '+(status.connectionType==='site'?'网站服务':'个人连接'):'可先手动设计'}</small></div><div class="studio-context"><span>${esc(o?.title||'方案 A')}</span><span>${space?'已选：'+esc(label(space)):'点选空间后可直接对它说话'}</span></div><div class="studio-chat-log" id="studio-chat-log"><article class="studio-message assistant"><p>从一个想法开始，或直接在画布上放空间。我可以帮你整理需求、修改当前选择和检查方案。</p><div class="studio-starts">${button('upload','上传任务书')}${button('prompt','说说我的想法','data-text="我想设计一个"')}${button('add','直接添加空间')}</div></article>${rows.map(m=>`<article class="studio-message ${m.role}" data-source="${m.source}"><small>${m.role==='user'?'你':m.role==='notice'?'画布记录':m.source==='model'?'AI 建议':'助手'}</small><p>${esc(m.text)}</p>${m.runId?`<button data-action="studio-run" data-id="${m.runId}">原始依据与操作 ↗</button>`:''}</article>`).join('')}${busy?'<article class="studio-message assistant studio-thinking"><span></span>正在处理，画布仍可手动编辑。</article>':''}</div><div class="studio-chat-bottom"><div class="studio-quick-actions">${button('metrics','检查面积与重叠')}${button('clone','复制方案')}${selected&&!polygon?button('grow','放大10%'):button('add','＋ 空间')}</div>${files().size?`<div class="studio-attachments">${[...files()].map(id=>{const f=p.files.find(f=>f.id===id);return f?`<button data-action="studio-detach" data-id="${id}" title="从本次对话移除">${esc(f.name)} ×</button>`:''}).join('')}</div>`:''}<form id="studio-chat-form"><label class="sr-only" for="studio-chat-input">向设计助手提出需求</label><textarea id="studio-chat-input" name="message" rows="2" maxlength="2000" placeholder="例如：加一个20㎡交流区，或把选中的空间放大">${esc(draft)}</textarea><div><button type="button" data-action="studio-upload" title="添加材料">${icon('plus')}</button><small>${busy?'请求处理中，请稍候':uploading?'正在读取材料…':'明确指令直接操作，复杂问题由 AI 协助'}</small><button type="submit" aria-label="发送" ${busy||uploading?'disabled':''}>${icon('arrow')}</button></div></form><details class="studio-send-scope"><summary>本次使用什么信息？</summary><p>当前项目的课程、阶段记录与当前选择；附件最多使用已关联的 3 份材料（当前 ${files().size} 份）。模型请求计入网站额度，拖动、复制和检查不消耗 AI 次数。</p></details></div></aside><main class="studio-work"><div class="studio-work-top"><div class="studio-option-tabs">${w.options.length?w.options.map(option=>`<a href="#/studio/${p.id}/${option.id}" class="${option.id===o?.id?'active':''}">${esc(option.title)}</a>`).join(''):'<span>方案 A · 随时开始</span>'}${button('clone','＋ 副本')}</div><div class="studio-view-tools">${button('view','平面','data-view="plan" aria-pressed="'+(view==='plan')+'"')}${button('view','体块','data-view="axon" aria-pressed="'+(view==='axon')+'"')}${view==='plan'?button('zoom-out','−','aria-label="缩小画布"')+button('zoom-in','＋','aria-label="放大画布"')+button('fit','全图'):''}${button('drawer','⋯','data-panel="more"')}</div></div><div class="studio-canvas ${highlight?'studio-highlight':''} ${drawing||pen?'studio-drawing':''}" id="studio-canvas">${view==='plan'?planSvg(plan,w.program,{interactive:true,resizable:true,selected,selectedStroke:pen||drawing?'':selectedStroke,scope:'studio-'+p.id,relationships:w.relationships||[]}):axonSvg(plan,w.program,{interactive:true,selected})}${!plan.spaces.length&&!plan.strokes?.length&&!drawing&&!pen?`<div class="studio-canvas-welcome"><p class="eyebrow">YOUR NEXT IDEA</p><h1>先动手，再慢慢完善。</h1><p>不必先填表。放一个空间、导入材料，<br>或让设计助手帮你起步。</p><div>${button('add','＋ 放一个空间')}${button('upload','导入材料')}</div></div>`:''}</div><div class="studio-metric-bar"><span><b>${metrics.area}</b>㎡ 已布置</span><span><b>${metrics.placed}</b> 个空间</span>${w.site.targetArea?`<span>目标 ${w.site.targetArea}㎡</span>`:''}<button data-action="studio-metrics" class="${metrics.overlaps.length||metrics.outside.length?'warning':''}">${metrics.overlaps.length} 组重叠 · ${metrics.outside.length} 个越界</button></div><div class="studio-bottom-tools">${button('select','选择')}${button('pen','自由画笔','aria-pressed="'+pen+'"')}${button('draw-polygon','绘制多边形','aria-pressed="'+!!drawing+'"')}${button('add','＋ 空间')}${button('preset','阅读','data-name="阅读区" data-area="20"')}${button('preset','交流','data-name="交流区" data-area="16"')}${button('preset','服务','data-name="服务空间" data-area="12"')}${button('upload','导入')}${button('prompt','AI 辅助','data-text="帮我检查当前方案，并建议下一步。"')}${button('drawer','批注 / 评审','data-panel="discussion"')}</div>${pen&&plan.strokes?.length?button('stroke-space','将上一笔闭合为空间','class="studio-stroke-convert"'):''}${stroke&&!pen&&!drawing&&view==='plan'?`<div class="studio-object-tools studio-stroke-tools"><span>已选手绘线</span>${button('selected-stroke-space','闭合为空间')}${button('stroke-delete','删除笔迹')}</div>`:''}${drawing?drawingTools():''}${space&&!drawing&&!pen?`<div class="studio-object-tools"><label>名称<input id="studio-space-name" value="${esc(label(space))}" maxlength="80"></label>${view==='axon'?`<label>高度 / m<input id="studio-space-height" type="number" min="1" max="30" step="0.01" value="${space.height}"></label>`:`<label>面积 / ㎡<input id="studio-space-area" type="number" min="0.25" max="1000000" step="0.01" value="${round(areaOf(space))}" ${polygon?'readonly':''}></label>`}${button('duplicate','复制')}${polygon?'':button('rotate','旋转90°')}${button('remove','删除')}${button('drawer','精确属性','data-panel="properties"')}</div>`:''}<p class="studio-canvas-help">${view==='axon'?'拖动体块顶面调整高度 · 上下方向键微调 0.1 米 · 可撤销':pen?'按住并移动绘制一笔，松开保存 · Esc 返回选择':drawing?'点选顶点，点击起点或“闭合轮廓”完成。Esc 取消。':polygon?'拖动顶点修改轮廓 · 拖动空间移动 · Ctrl/Cmd+Z 撤销':stroke?'拖动笔迹移动 · 方向键微调 · Delete 删除 · 闭合为空间可拉伸':'空白处拖动平移 · 点选笔迹或空间 · Ctrl/Cmd+Z 撤销'}</p></main>${drawer?`<aside class="studio-drawer"><div class="studio-drawer-title"><h2>${{materials:'项目材料',process:'设计过程',discussion:'围绕作品讨论',properties:'选中对象',share:'保存并邀请',more:'项目工具'}[drawer]||'工具'}</h2>${button('close-drawer','×','aria-label="关闭侧栏"')}</div>${drawerBody(p,w,o,space,metrics,label)}</aside>`:''}</div><input type="file" id="studio-file-input" accept=".skp,.pdf,.png,.jpg,.jpeg" hidden></div>`}
 function drawerBody(p,w,o,s,m,label){if(drawer==='materials')return `<p>上传后自动保留文件名和来源，可选择用于本次对话。</p>${button('upload','＋ 上传材料')}<div class="studio-file-list">${p.files.map(f=>`<article><button data-action="studio-open-file" data-id="${f.id}"><b>${esc(f.name)}</b><small>${f.type.toUpperCase()} · ${(f.size/1048576).toFixed(1)} MB</small></button><label><input type="checkbox" data-studio-file="${f.id}" ${files().has(f.id)?'checked':''}>用于对话</label>${f.extractedText?'<small>含前10页内浏览器提取文字，需核对原件。</small>':''}</article>`).join('')||'<p>还没有材料，可以直接开始画。</p>'}</div>`;
 if(drawer==='process')return `<p>设计过程随材料和操作逐步积累，随时补充，无需按顺序填表。</p>${DESIGN_STAGES.map(stage=>`<a class="studio-process-link" href="#/process/${p.id}/${stage.id}"><span>0${stage.id}</span><b>${stage.name}</b><small>${w.stages[stage.id-1].status==='idle'?'可后补':'已有记录'} ↗</small></a>`).join('')}<a class="btn text" href="#/board/${p.id}">查看材料看板 →</a>`;
 if(drawer==='discussion')return `<p>真实教师、同伴与使用者通过评审室围绕版本提问。AI 模拟建议与真人反馈分别保存。</p>${button('drawer','保存版本并邀请','data-panel="share"')}<a class="btn text" href="#/collaboration">打开评审室 →</a>${p.feedback.slice(0,8).map(f=>`<article class="studio-feedback"><small>${esc(f.source)} · ${esc(f.status)}</small><h3>${esc(f.title)}</h3><p>${esc(f.suggestion)}</p><a href="#/reviews">回应与定位 →</a></article>`).join('')}`;
 if(drawer==='properties')return s?`<h3>${esc(label(s))}</h3><p>${isPolygon(s)?'在平面拖动顶点可调整轮廓。此处可修改位置和高度。':'修改尺寸与位置，面积会自动计算。'}</p><form id="studio-properties-form" data-id="${s.id}" data-project="${p.id}">${[['x','X / m',0,1000],['y','Y / m',0,1000],['width','宽 / m',.5,1000],['depth','深 / m',.5,1000],['height','高 / m',1,30]].filter(([k])=>!isPolygon(s)||!['width','depth'].includes(k)).map(([k,l,min,max])=>`<label>${l}<input name="${k}" type="number" min="${min}" max="${max}" step="0.01" value="${k==='height'?s.height:boundsOf(s)[k]}" required></label>`).join('')}<button class="btn primary" type="submit">应用</button></form>`:'<p>在平面画布上点选空间，再查看或修改属性。</p>';
 if(drawer==='share')return `<p>将当前方案、材料与过程保存为固定版本，再邀请各方讨论。</p><form id="studio-share-form" data-project="${p.id}"><label>这一版主要改了什么？（可稍后补充）<textarea name="note" maxlength="3000" rows="4" placeholder="写一句关键变化或希望讨论的问题。"></textarea></label><button type="submit" class="btn primary">保存版本并创建评审室</button></form><small>创建后仍需你选择受邀者。项目不会自动公开。</small>`;
 return `<div class="studio-more-links"><a href="#/layout/${p.id}/${o?.id||''}">详细功能与布局工具 →</a><a href="#/workspace/${p.id}">图纸与真实模型 →</a><a href="#/archive">版本与导出 →</a><a href="#/course">课程任务 →</a><a href="#/projects">我的项目 →</a><button data-action="studio-save">保存 / 重试保存</button><button data-action="studio-new-project">新建空白项目</button></div><form id="studio-canvas-form"><label>画布宽 / m<input type="number" name="width" value="${o?.plan?.width||30}" min="1" max="1000" step="0.5" required></label><label>画布深 / m<input type="number" name="depth" value="${o?.plan?.depth||20}" min="1" max="1000" step="0.5" required></label><button type="submit" class="btn secondary">调整画布</button></form>`}
 function drawingTools(){
   return `<div class="studio-object-tools studio-draw-tools"><span>已放置 ${drawing.points.length} 个顶点</span>${button('close-polygon','闭合轮廓',drawing.points.length<3?'disabled':'')}${button('cancel-polygon','取消绘制')}</div>`;
 }
 async function closePolygon(){
   const draft=drawing;
   if(!draft||draft.points.length<3||draft.closing)return;
   draft.closing=true;
   try{
     await mutate([{type:'add_polygon',vertices:draft.points}],'绘制多边形',false,()=>{if(drawing===draft)drawing=null});
   }finally{draft.closing=false}
 }
 const snap=point=>[Math.round(point.x*2)/2,Math.round(point.y*2)/2];
 function boundedVertex(point,plan){
   const [x,y]=snap(point);
   return [Math.max(0,Math.min(plan.width,x)),Math.max(0,Math.min(plan.depth,y))];
 }
 function polygonPreview(svg){
   const points=drawing.points;
   const preview=document.createElementNS(svg.namespaceURI,'g');
   preview.setAttribute('pointer-events','none');
   preview.innerHTML=`<polyline points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="#365f7e" stroke-width=".14"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="${i===0?.34:.21}" fill="#365f7e" stroke="white" stroke-width=".08"/>`).join('')}`;
   svg.append(preview);
 }
 function viewport(){const svg=document.querySelector('[data-plan-canvas]'),plan=planOf(currentOption());if(!svg)return;const width=(plan.width+3.6)/zoom,depth=(plan.depth+3.6)/zoom;svg.setAttribute('viewBox',[plan.width/2+panX-width/2,plan.depth/2+panY-depth/2,width,depth].join(' '))}
 function mount(){viewport();const input=document.querySelector('#studio-chat-input');input?.addEventListener('input',()=>draft=input.value);input?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();input.form.requestSubmit()}});const logEl=document.querySelector('#studio-chat-log');if(logEl)logEl.scrollTop=logEl.scrollHeight;document.querySelector('#studio-project-name')?.addEventListener('change',async e=>{try{await mutate([{type:'rename_project',name:e.target.value}],'重命名项目')}catch(error){toast(error.message);render()}});document.querySelector('#studio-space-name')?.addEventListener('change',e=>mutate([{type:'update_space',targetId:selected,name:e.target.value}],'重命名空间').catch(e=>toast(e.message)));document.querySelector('#studio-space-height')?.addEventListener('change',e=>mutate([{type:'update_space',targetId:selected,height:Number(e.target.value)}],'修改体块高度').catch(error=>{toast(error.message);render()}));document.querySelector('#studio-space-area')?.addEventListener('change',e=>mutate([{type:'update_space',targetId:selected,area:Number(e.target.value)}],'调整面积').catch(e=>toast(e.message)));document.querySelector('#studio-file-input')?.addEventListener('change',e=>addFile(e.target.files[0]));document.querySelectorAll('[data-studio-file]').forEach(el=>el.addEventListener('change',()=>{if(el.checked){if(files().size>=3){el.checked=false;toast('每次对话最多关联3份材料，请先移除一份。');return}files().add(el.dataset.studioFile)}else files().delete(el.dataset.studioFile)}));const canvas=document.querySelector('#studio-canvas');canvas?.addEventListener('dragover',e=>{e.preventDefault()});canvas?.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files[0])addFile(e.dataTransfer.files[0])});
 const svg=document.querySelector('[data-plan-canvas]');
 let drag=null;
 const key=async e=>{
   if(e.target.matches('input,textarea,select')||e.isComposing)return;
   try{
     if(e.key==='Escape'){
       document.querySelector('svg[data-gesture-route]')?.removeAttribute('data-gesture-route');
       drawing=null;pen=false;selected='';selectedStroke='';render();return;
     }
     if(drawing)return;
     if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();await step(e.shiftKey);return}
     if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();await step(true);return}
     if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-space-id]')){
       e.preventDefault();selected=e.target.closest('[data-space-id]').dataset.spaceId;render();return;
     }
     const strokeTarget=e.target.closest('[data-stroke-id]');
     if((e.key==='Enter'||e.key===' ')&&strokeTarget){
       e.preventDefault();selectedStroke=strokeTarget.dataset.strokeId;selected='';render();
       document.querySelector('[data-stroke-id="'+selectedStroke+'"]')?.focus();return;
     }
     if(selectedStroke){
       if(e.key==='Delete'||e.key==='Backspace'){
         e.preventDefault();await mutate([{type:'delete_stroke',targetId:selectedStroke}],'删除笔迹');return;
       }
       const delta={ArrowLeft:[-.5,0],ArrowRight:[.5,0],ArrowUp:[0,-.5],ArrowDown:[0,.5]}[e.key];
       if(delta){
         e.preventDefault();await mutate([{type:'move_stroke',targetId:selectedStroke,dx:delta[0],dy:delta[1]}],'移动笔迹');
         document.querySelector('[data-stroke-id="'+selectedStroke+'"]')?.focus();
       }
       return;
     }
     const space=currentOption()?.plan.spaces.find(s=>s.id===selected);
     if(!space)return;
     if(e.key==='Delete'||e.key==='Backspace'){
       e.preventDefault();await mutate([{type:'delete_space',targetId:selected}],'删除空间');return;
     }
     const delta={ArrowLeft:[-.5,0],ArrowRight:[.5,0],ArrowUp:[0,-.5],ArrowDown:[0,.5]}[e.key];
     if(delta){
       e.preventDefault();
       const {x,y}=boundsOf(space);
       await mutate([{type:'update_space',targetId:selected,x:Math.max(0,x+delta[0]),y:Math.max(0,y+delta[1])}],'移动空间');
     }
   }catch(error){toast(error.message)}
 };
 document.addEventListener('keydown',key);
 const massCanvas=canvas?.querySelector('svg');
 const guarded=task=>task.catch(error=>{toast(error.message);render()});
 if(view==='axon'&&massCanvas){
   mountExtrusion(massCanvas,planOf(currentOption()),project().workflow?.program||[],{
     select:id=>{selected=id;selectedStroke=''},render,
     commit:(id,height)=>guarded(mutate([{type:'update_space',targetId:id,height}],'拉伸体块'))
   });
 }
 if(svg&&pen){
   mountPen(svg,planOf(currentOption()),points=>guarded(mutate([{type:'draw_stroke',points}],'自由手绘')),render);
 }else if(svg){
   if(drawing)polygonPreview(svg);
   else mountStrokeSelection(svg,planOf(currentOption()),{
     select:id=>{selectedStroke=id;selected=''},render,
     commit:(id,dx,dy)=>guarded(mutate([{type:'move_stroke',targetId:id,dx,dy}],'移动笔迹'))
   });
   const point=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
   svg.addEventListener('pointerdown',e=>{
     if(e.button!==0||drag)return;
     e.preventDefault();
     const pointerId=e.pointerId;
     if(drawing)drag={pointerId,mark:true,clientX:e.clientX,clientY:e.clientY};
     else{
       selectedStroke='';
       const g=e.target.closest('[data-space-id]');
       const space=currentOption()?.plan.spaces.find(s=>s.id===g?.dataset.spaceId);
       if(space){
         const initial=boundsOf(space);
         const vertex=e.target.closest('[data-vertex-index]');
         drag={pointerId,id:space.id,start:point(e),initial,...initial,resizing:!!e.target.closest('[data-resize-space]')};
         if(vertex){
           drag.vertexIndex=Number(vertex.dataset.vertexIndex);
           drag.vertexStart=footprintOf(space)[drag.vertexIndex];
           drag.points=footprintOf(space);
         }
       }else drag={pointerId,panning:true,clientX:e.clientX,clientY:e.clientY,panX,panY,scale:svg.getScreenCTM().a};
     }
     svg.setPointerCapture(pointerId);
   });
   svg.addEventListener('pointermove',e=>{
     if(!drag||drag.pointerId!==e.pointerId||drag.mark)return;
     if(drag.panning){
       panX=drag.panX-(e.clientX-drag.clientX)/drag.scale;
       panY=drag.panY-(e.clientY-drag.clientY)/drag.scale;
       viewport();return;
     }
     const at=point(e),s=drag.initial,p=currentOption().plan,dx=at.x-drag.start.x,dy=at.y-drag.start.y;
     const g=svg.querySelector('[data-space-id="'+drag.id+'"]');
     if(!dx&&!dy&&!drag.moved)return;
     drag.moved=true;
     if(drag.vertexStart){
       const [vx,vy]=drag.vertexStart;
       drag.vertexPoint=boundedVertex({x:vx+dx,y:vy+dy},p);
       const [x,y]=drag.vertexPoint;
       const points=drag.points.map((v,i)=>i===drag.vertexIndex?drag.vertexPoint:v);
       g.querySelector('polygon').setAttribute('points',points.map(([x,y])=>[x-s.x,y-s.y].join(',')).join(' '));
       const handle=g.querySelector('[data-vertex-index="'+drag.vertexIndex+'"]');
       handle.setAttribute('cx',x-s.x);
       handle.setAttribute('cy',y-s.y);
     }else if(drag.resizing){
       drag.width=Math.max(.5,Math.min(p.width-s.x,Math.round((s.width+dx)*2)/2));
       drag.depth=Math.max(.5,Math.min(p.depth-s.y,Math.round((s.depth+dy)*2)/2));
       const rect=g.querySelector('rect');
       rect.setAttribute('width',drag.width);
       rect.setAttribute('height',drag.depth);
     }else{
       drag.x=Math.max(0,Math.min(Math.max(0,p.width-s.width),Math.round((s.x+dx)*2)/2));
       drag.y=Math.max(0,Math.min(Math.max(0,p.depth-s.depth),Math.round((s.y+dy)*2)/2));
       g.setAttribute('transform',`translate(${drag.x} ${drag.y})`);
     }
   });
   svg.addEventListener('pointerup',async e=>{
     if(!drag||drag.pointerId!==e.pointerId)return;
     const d=drag;
     drag=null;
     if(d.panning)return;
     try{
       if(d.mark){
         if(!drawing||drawing.closing||Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)>8)return;
         const plan=planOf(currentOption()), at=point(e);
         if(at.x<0||at.y<0||at.x>plan.width||at.y>plan.depth)return;
         const vertex=boundedVertex(at,plan), points=drawing.points;
         const first=points[0];
         if(first&&vertex[0]===first[0]&&vertex[1]===first[1]){await closePolygon();return}
         if(points.length>=MAX_VERTICES)throw Error('顶点已达上限，请闭合轮廓。');
         if(points.some(([x,y])=>x===vertex[0]&&y===vertex[1]))throw Error('这个位置已有顶点。');
         points.push(vertex);render();return;
       }
       selected=d.id;
       if(d.vertexStart){
         if(d.vertexPoint&&d.vertexPoint.some((v,i)=>v!==d.vertexStart[i])){
           await mutate([{type:'move_vertex',targetId:d.id,vertexIndex:d.vertexIndex,point:d.vertexPoint}],'调整多边形顶点');return;
         }
       }else if(['x','y','width','depth'].some(key=>d[key]!==d.initial[key])){
         await mutate([{type:'update_space',targetId:d.id,...(d.resizing?{width:d.width,depth:d.depth}:{x:d.x,y:d.y})}],d.resizing?'缩放空间':'移动空间');return;
       }
       render();
     }catch(error){toast(error.message);render()}
   });
   svg.addEventListener('pointercancel',e=>{if(drag?.pointerId===e.pointerId){drag=null;render()}});
 }
 cleanup=()=>{document.removeEventListener('keydown',key);drag=null}}
 async function addFile(file){if(!file)return;if(uploading)return;uploading=true;const pId=project()?.id;try{await ensure();const f=await upload(file);if(project()?.id!==pId)return;if(files().size<3)files().add(f.id);else toast('材料已保存；对话最多关联3份，可在材料中切换。');log('notice',f.name+' 已加入。'+(f.extractedText?'已提取前10页内可读取文字（最多12000字符），可让助手整理需求；请核对原件。':f.type==='pdf'?'未读取到足够文字，扫描件可在图纸区选页转图。':'可选择它作为对话依据。'));await save();drawer='materials'}catch(error){toast(error.message)}finally{uploading=false;render()}}
 async function send(message){if(!message.trim()||busy||uploading)return;await ensure();const projectId=project().id;draft='';log('user',message);const intent=localStudioIntent(message,project(),selection());if(intent){if(intent.command==='undo')await step();else if(intent.command==='redo')await step(true);else if(intent.command==='metrics')await metricsReply();else if(intent.clarify){log('assistant',intent.clarify);await save();render()}else await mutate(intent.actions,'对话操作',true);return}
 busy=true;render();let runId='';try{await save();const p=project(),before=captureDraft(p),context=selection(),messages=(p.workflow.assistantLog||[]).filter(m=>['user','assistant'].includes(m.role)).slice(-7,-1).map(m=>({role:m.role,text:m.text.slice(0,2000)}));const response=await api('/api/ai/generate',{method:'POST',headers:{'If-Match':etag()},body:JSON.stringify({projectId,requestId:crypto.randomUUID(),kind:'assistant',assistantInput:message,assistantSelection:context,assistantMessages:messages,fileIds:[...files()].filter(id=>p.files.some(f=>f.id===id)).slice(0,3),views:[]})});runId=response.run.id;if(response.run.status!=='succeeded')throw Error('任务尚未完成，请先查看生成记录。');if(project()?.id!==projectId)return;const result=response.run.output;if(result.actions.length){await save();const applied=await api('/api/ai/runs/'+runId+'/apply',{method:'POST',headers:{'If-Match':etag()},body:'{}'});replaceState(applied.state,applied.etag);activeOption=applied.assistantResult?.optionId||context.optionId;selected=applied.assistantResult?.createdIds?.at(-1)||applied.assistantResult?.changedIds?.filter(id=>currentOption()?.plan.spaces.some(s=>s.id===id)).at(-1)||'';if(activeOption!==context.optionId)location.hash='#/studio/'+projectId+'/'+activeOption;history().record(before,captureDraft(project()),'AI 设计修改');log('notice',applied.assistantResult?.summary||'操作已应用到画布，可撤销。',runId,'model');if(result.message)log('assistant',result.message,runId,'model')}else log('assistant',[result.message,...result.questions].filter(Boolean).join('\n'),runId,'model');await save()}catch(error){if(project()?.id===projectId){log('assistant',error.code==='source_changed'||error.code==='state_conflict'?'设计已变化，本次建议没有应用。你的手动修改保留，可查看原始记录。':error.message+' 当前画布未被本次 AI 请求覆盖，未自动重试。',runId,'model');try{await save()}catch{}}}finally{busy=false;render()}}
 async function metricsReply(){await ensure();const w=project().workflow,m=planMetrics(currentOption().plan,w.program,w.relationships||[]);highlight=true;log('assistant','当前已布置 '+m.area+'㎡、'+m.placed+' 个空间。发现 '+m.overlaps.length+' 组空间重叠、'+m.outside.length+' 个越界。'+(m.overlaps.length||m.outside.length?'问题已在画布标出。':'目前没有这些几何冲突。')+'\n这是几何检查，空间使用与专业要求仍需结合材料判断。');await save();render()}
 async function action(a,b){try{if(a==='studio-save'){await save();toast('已保存至云端。');return}if(a==='studio-new-project'){await quickCreate();return}if(a==='studio-upload'){document.querySelector('#studio-file-input').click();return}if(a==='studio-drawer'){drawer=drawer===b.dataset.panel?'':b.dataset.panel;render();return}if(a==='studio-close-drawer'){drawer='';render();return}if(a==='studio-mobile'){mobile=b.dataset.value;render();return}if(a==='studio-prompt'){draft=b.dataset.text||'';mobile='chat';render();document.querySelector('#studio-chat-input')?.focus();return}if(a==='studio-detach'){files().delete(b.dataset.id);render();return}if(a==='studio-open-file'){location.hash='#/workspace/'+project().id;document.dispatchEvent(new CustomEvent('studio-open-material',{detail:{id:b.dataset.id}}));return}if(a==='studio-run'){await showRun(b.dataset.id);return}if(a==='studio-selected-stroke-space'){if(selectedStroke)await mutate([{type:'stroke_to_space',targetId:selectedStroke}],'手绘线建面');return}if(a==='studio-stroke-delete'){if(selectedStroke)await mutate([{type:'delete_stroke',targetId:selectedStroke}],'删除笔迹');return}if(a==='studio-pen'){selectedStroke='';view='plan';drawing=null;selected='';pen=!pen;render();return}if(a==='studio-stroke-space'){const stroke=currentOption()?.plan.strokes?.at(-1);if(stroke)await mutate([{type:'stroke_to_space',targetId:stroke.id}],'手绘线建面',false,()=>{pen=false});return}if(a==='studio-view'){selectedStroke='';view=b.dataset.view;pen=false;if(view!=='plan')drawing=null;render();return}if(a==='studio-zoom-in'||a==='studio-zoom-out'){zoom=Math.max(1,Math.min(6,zoom*(a==='studio-zoom-in'?1.4:1/1.4)));viewport();return}if(a==='studio-fit'){zoom=1;panX=0;panY=0;viewport();return}if(a==='studio-select'||a==='studio-cancel-polygon'){selectedStroke='';pen=false;selected='';drawing=null;view='plan';render();return}if(a==='studio-draw-polygon'){selectedStroke='';pen=false;if(drawing)return;view='plan';selected='';drawer='';drawing={optionId:activeOption,points:[],closing:false};render();return}if(a==='studio-close-polygon'){await closePolygon();return}if(a==='studio-undo')return await step();if(a==='studio-redo')return await step(true);if(a==='studio-metrics')return await metricsReply();if(a==='studio-add'||a==='studio-preset')await mutate([{type:'add_space',name:b.dataset.name||'空间 '+((currentOption()?.plan.spaces.length||0)+1),area:Number(b.dataset.area)||20}],'添加空间',true);else if(a==='studio-clone')await mutate([{type:'duplicate_option'}],'复制方案');else if(a==='studio-grow'){if(!selected)return toast('先在画布上选中空间。');await mutate([{type:'update_space',targetId:selected,scale:1.1}],'放大空间')}else if(a==='studio-remove')await mutate([{type:'delete_space',targetId:selected}],'删除空间');else if(a==='studio-duplicate')await mutate([{type:'duplicate_space',targetId:selected}],'复制空间');else if(a==='studio-rotate'){const s=currentOption()?.plan.spaces.find(s=>s.id===selected);if(s)await mutate([{type:'update_space',targetId:selected,width:s.depth,depth:s.width}],'旋转空间')}}catch(error){toast(error.message)}}
 async function submit(form){if(form.id==='studio-chat-form'){const text=String(new FormData(form).get('message')||'').trim();try{await send(text)}catch(error){log('assistant',error.message);toast(error.message);render()}return}const d=Object.fromEntries(new FormData(form));if(form.dataset.project&&form.dataset.project!==project().id)throw Error('项目已切换，请重新操作。');if(form.id==='studio-properties-form')await mutate([{type:'update_space',targetId:form.dataset.id,...Object.fromEntries(Object.entries(d).map(([k,v])=>[k,Number(v)]))}],'调整空间属性');else if(form.id==='studio-canvas-form'){await ensure();const before=captureDraft(project()),next=structuredClone(project());next.workflow.options.find(o=>o.id===activeOption).plan.width=Number(d.width);next.workflow.options.find(o=>o.id===activeOption).plan.depth=Number(d.depth);updateProject(next);history().record(before,captureDraft(project()),'调整画布');await save();render()}else if(form.id==='studio-share-form'){await ensure();await save();const p=project(),response=await api('/api/snapshots',{method:'POST',headers:{'If-Match':etag()},body:JSON.stringify({projectId:p.id,kind:'stage',label:(currentOption()?.title||'方案')+' · V'+(p.versions.length+1),note:d.note?.trim()||'阶段讨论稿；关键设计理由待学生补充。'})});replaceState(response.state,response.etag);const room=await api('/api/review-rooms',{method:'POST',body:JSON.stringify({projectId:p.id,versionId:response.versionId,title:p.name+' · 方案讨论'})});drawer='';location.hash='#/room/'+room.room.id}}
 function dispose(){cleanup?.();cleanup=null}
 return {page,mount,action,submit,dispose,isBusy:()=>busy};
}
