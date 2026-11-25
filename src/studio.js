import {mountPen,mountExtrusion,mountStrokeSelection,mountMassOrbit,mountPlanTouchNavigation,releaseGesture} from './canvas-gestures.js';
import {createPlanUnderlay} from './plan-underlay.js';
import {edgeFields,mountEdgeEditor} from './edge-editor.js';
import {mountRequirementEditor,readRequirementForm,requirementFields} from './requirement-editor.js';
import {draftPreviewMarkup,optionComparison} from './studio-comparison.js';
import {previewStudioActions} from '../shared/studio-preview.js';
import {draftSaveNotice} from './draft-recovery.js';
import {locatedBounds,requirementDescription,requirementIssuesMarkup} from './requirement-metrics.js';
import {icon} from './data.js';
import {DESIGN_STAGES,workflowOf} from '../shared/design-workflow.js';
import {planOf,planMetrics,planIssues,planSvg,axonSvg,round,areaOf} from '../shared/space-planning.js';
import {boundsOf,endpointAtLength,footprintOf,isPolygon,MAX_VERTICES,snapPlanPoint} from '../shared/plan-geometry.js';
import {prepareStudio,studioOption,applyStudioActions,captureDraft,draftKey,DraftHistory,localStudioIntent} from '../shared/studio-actions.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(a,label,extra='')=>`<button type="button" data-action="studio-${a}" ${extra}>${label}</button>`;
export function createStudio({project,projects,api,save,etag,updateProject,replaceState,changed,render,toast,getStatus,isReady,quickCreate,upload,showRun}){
 let drawing=null, pen=false, selectedStroke='', snapping=true, directionAngle=0;
 let requirementEdit=null, requirementSource='', locatedIssue=null;
 let proposed=null, applying=false, comparison=null;
 let assistantClosed=false;
 const massCameras=new Map();
 const massCamera=()=>{const key=project()?.id+'/'+activeOption;if(!massCameras.has(key))massCameras.set(key,{yaw:Math.PI/4,pitch:Math.PI/6,zoom:1,panX:0,panY:0});return massCameras.get(key)};
 let activeProject='',activeOption='',selected='',drawer='',view='plan',mobile='canvas',draft='',busy=false,uploading=false,highlight=false,cleanup=null,zoom=1,panX=0,panY=0,attached=new Map(),queue=Promise.resolve();const histories=new Map();
 const history=()=>{const id=project()?.id;if(!histories.has(id))histories.set(id,new DraftHistory());return histories.get(id)};
 const files=()=>{const id=project()?.id;if(!attached.has(id))attached.set(id,new Set());return attached.get(id)};
 const currentOption=()=>studioOption(project(),activeOption);
 const underlay=createPlanUnderlay({project,option:currentOption,ensure,mutate,upload,render,toast});
 const selection=()=>({optionId:currentOption()?.id||'',spaceIds:selected?[selected]:[]});
 const projectKey=()=>draftKey(captureDraft(project()));
 const currentPreview=()=>proposed&&proposed.projectId===project()?.id&&proposed.context.optionId===activeOption?proposed:null;
 const previewStale=entry=>entry.base!==projectKey();
 function log(role,text,runId='',source='local'){const p=project();if(!p?.workflow)return;const items=p.workflow.assistantLog??=[];items.push({id:crypto.randomUUID(),role,text:String(text).slice(0,2400),runId,optionId:currentOption()?.id||'',source,createdAt:new Date().toISOString()});p.workflow.assistantLog=items.slice(-80);changed()}
 async function ensure(){if(!isReady())throw Error('请先登录，保存项目并使用 AI。');if(!project()?.workflow?.options.length){updateProject(prepareStudio(project()));activeOption=project().workflow.options[0].id;await save()}return currentOption()}
 async function mutate(actions,label='设计修改',announce=false,onApply){if(applying)throw Error('正在采用预览，请稍等。');const projectId=project().id,captured=selection();return queue=queue.catch(()=>{}).then(async()=>{if(project()?.id!==projectId)throw Error('项目已切换，未执行这项操作。');if(!isReady())throw Error('请先登录，保存项目并使用 AI。');const before=captureDraft(project()),result=applyStudioActions(project(),actions,{optionId:captured.optionId||activeOption,spaceIds:captured.spaceIds});updateProject(result.project);onApply?.();activeOption=result.optionId;if(actions.some(action=>['stroke_to_space','delete_stroke','duplicate_option','add_space','add_polygon'].includes(action.type)))selectedStroke='';selected=result.createdIds.at(-1)||result.changedIds.filter(id=>studioOption(project(),activeOption)?.plan.spaces.some(s=>s.id===id)).at(-1)||'';history().record(before,captureDraft(project()),label);if(!actions.every(action=>action.type==='draw_stroke'))log('notice',result.summary);if(announce)mobile='canvas';if(activeOption!==captured.optionId)location.hash='#/studio/'+projectId+'/'+activeOption;try{await save()}finally{render()}return result})}
 async function step(redo=false){if(busy||applying)return toast('请等待当前 AI 请求结束，再撤销或重做。');const result=history().step(project(),redo);if(!result)return;updateProject(result.project);selected='';selectedStroke='';activeOption=studioOption(project(),activeOption)?.id||'';log('notice',(redo?'重做：':'撤销：')+result.label);try{await save()}finally{render()}}
 function page(requested){const p=project();if(!p)return `<div class="studio-no-project"><h1>开始一次新的共创</h1>${button('new-project','新建项目')}</div>`;if(activeProject!==p.id){activeProject=p.id;activeOption='';drawing=null;pen=false;selected='';drawer='';requirementEdit=null;locatedIssue=null;proposed=null;comparison=null;draft='';mobile='canvas';zoom=1;panX=0;panY=0}const w=workflowOf(p),o=studioOption(p,requested||activeOption);activeOption=o?.id||'';if(drawing&&drawing.optionId!==activeOption)drawing=null;const plan=planOf(o),space=plan.spaces.find(s=>s.id===selected);if(!space)selected='';const stroke=plan.strokes?.find(s=>s.id===selectedStroke);if(!stroke)selectedStroke='';const polygon=space&&isPolygon(space);const metrics=planMetrics(plan,w.program,w.relationships||[]),status=getStatus(),rows=w.assistantLog||[],label=s=>s.label||w.program.find(p=>p.id===s.programId)?.name||'空间';
 const located=locatedIssue?.optionId===o?.id?planIssues(o?.id||'',metrics).find(issue=>issue.key===locatedIssue?.key)?.spaceIds||[]:[];
 const candidate=currentPreview(), stale=candidate?previewStale(candidate):false;
 return `<div class="studio" data-assistant="${assistantClosed?'closed':'open'}" data-mobile="${mobile}" data-drawer="${drawer? 'open':'closed'}"><header class="studio-header"><a class="studio-brand" href="#/projects" title="返回项目">${icon('cube')}<b>共创</b></a><input class="studio-project-name" id="studio-project-name" aria-label="项目名称" value="${esc(p.name)}" maxlength="100"><span class="save-status"></span><div class="studio-header-actions">${button('toggle-assistant','设计助手','aria-expanded="'+!assistantClosed+'"')}${button('undo',icon('history')+'<span>撤销</span>',history().undoStack.length&&!busy&&!applying?'':'disabled')}${button('redo','↪<span>重做</span>',history().redoStack.length&&!busy&&!applying?'':'disabled')}${button('drawer','材料','data-panel="materials"')}${button('drawer','过程','data-panel="process"')}<button class="studio-share" data-action="studio-drawer" data-panel="share">${icon('chat')}发起讨论</button><a href="${isReady()?'/account':'/login'}">${isReady()?'账号':'登录'}</a></div></header>${draftSaveNotice('studio-conflict')}<div class="studio-mobile-tabs">${button('mobile','画布','data-value="canvas"')}${button('mobile','AI 助手','data-value="chat"')}${button('drawer','属性 / 材料','data-panel="properties"')}</div><div class="studio-body"><aside class="studio-assistant"><div class="studio-assistant-title"><span>${icon('spark')}设计助手</span><small>${busy?'正在理解…':status.configured?'DeepSeek · '+(status.connectionType==='site'?'网站服务':'个人连接'):'可先手动设计'}</small></div><div class="studio-context"><span>${esc(o?.title||'方案 A')}</span><span>${space?'已选：'+esc(label(space)):'点选空间后可直接对它说话'}</span></div><div class="studio-chat-log" id="studio-chat-log"><article class="studio-message assistant"><p>从一个想法开始，或直接在画布上放空间。我可以帮你整理需求、修改当前选择和检查方案。</p><div class="studio-starts">${button('upload','上传任务书')}${button('prompt','说说我的想法','data-text="我想设计一个"')}${button('add','直接添加空间')}</div></article>${rows.map(m=>`<article class="studio-message ${m.role}" data-source="${m.source}"><small>${m.role==='user'?'你':m.role==='notice'?'画布记录':m.source==='model'?'AI 建议':'助手'}</small><p>${esc(m.text)}</p>${m.runId?`<button data-action="studio-run" data-id="${m.runId}">原始依据与操作 ↗</button>`:''}</article>`).join('')}${busy?'<article class="studio-message assistant studio-thinking"><span></span>正在处理，画布仍可手动编辑。</article>':''}</div><div class="studio-chat-bottom"><div class="studio-quick-actions">${button('metrics','检查面积与重叠')}${button('clone','复制方案')}${selected&&!polygon?button('grow','放大10%'):button('add','＋ 空间')}</div>${files().size?`<div class="studio-attachments">${[...files()].map(id=>{const f=p.files.find(f=>f.id===id);return f?`<button data-action="studio-detach" data-id="${id}" title="从本次对话移除">${esc(f.name)} ×</button>`:''}).join('')}</div>`:''}<form id="studio-chat-form"><label class="sr-only" for="studio-chat-input">向设计助手提出需求</label><textarea id="studio-chat-input" name="message" rows="2" maxlength="2000" placeholder="例如：加一个20㎡交流区，或把选中的空间放大">${esc(draft)}</textarea><div><button type="button" data-action="studio-upload" title="添加材料">${icon('plus')}</button><small>${busy?'请求处理中，请稍候':uploading?'正在读取材料…':'修改先预览，确认后采用'}</small><button type="submit" aria-label="发送" ${busy||uploading||applying?'disabled':''}>${icon('arrow')}</button></div></form><details class="studio-send-scope"><summary>本次使用什么信息？</summary><p>当前项目的课程、阶段记录与当前选择；附件最多使用已关联的 3 份材料（当前 ${files().size} 份）。模型请求计入网站额度，拖动、复制和检查不消耗 AI 次数。</p></details></div></aside><main class="studio-work"><div class="studio-work-top"><div class="studio-option-tabs">${w.options.length?w.options.map(option=>`<a href="#/studio/${p.id}/${option.id}" class="${option.id===o?.id?'active':''}">${esc(option.title)}</a>`).join(''):'<span>方案 A · 随时开始</span>'}${button('clone','＋ 副本')}</div><div class="studio-view-tools">${button('view','平面','data-view="plan" aria-pressed="'+(view==='plan')+'"')}${button('view','体块','data-view="axon" aria-pressed="'+(view==='axon')+'"')}${view==='plan'?button('zoom-out','−','aria-label="缩小画布"')+button('zoom-in','＋','aria-label="放大画布"')+button('fit','全图'):button('mass-reset','复位视角')}${w.options.length>=2?button('compare','方案对照'):''}${button('drawer','视角','data-panel="viewpoints"')}${button('drawer','⋯','data-panel="more"')}</div></div>${candidate?draftPreviewMarkup({...candidate,stale,busy:busy||applying}):''}<div class="studio-canvas ${highlight?'studio-highlight':''} ${drawing||pen?'studio-drawing':''}" id="studio-canvas">${view==='plan'?planSvg(plan,w.program,{interactive:true,resizable:true,selected,located,changes:candidate&&!stale?candidate.preview.changes:[],selectedStroke:pen||drawing?'':selectedStroke,scope:'studio-'+p.id,relationships:w.relationships||[]}):axonSvg(plan,w.program,{interactive:true,selected,camera:massCamera()})}${!plan.spaces.length&&!plan.strokes?.length&&!plan.underlay&&!drawing&&!pen?`<div class="studio-canvas-welcome"><h1>空白画布</h1><p>不必先填表。放一个空间、导入材料，<br>或让设计助手帮你起步。</p><div>${button('add','＋ 放一个空间')}${button('upload','导入材料')}</div></div>`:''}</div><div class="studio-metric-bar"><span><b>${metrics.area}</b>㎡ 已布置</span><span><b>${metrics.placed}</b> 个空间</span>${w.site.targetArea?`<span>目标 ${w.site.targetArea}㎡</span>`:''}<button data-action="studio-drawer" data-panel="requirements" class="${metrics.overlaps.length||metrics.outside.length?'warning':''}">${metrics.overlaps.length} 组重叠 · ${metrics.outside.length} 个越界 · 需求与指标</button></div><div class="studio-bottom-tools">${button('drawer','底图','data-panel="underlay"')}${button('select','选择')}${button('pen','自由画笔','aria-pressed="'+pen+'"')}${button('draw-polygon','绘制多边形','aria-pressed="'+!!drawing+'"')}${view==='plan'?button('snap','吸附 '+(snapping?'开':'关'),'aria-pressed="'+snapping+'" title="按住 Alt 临时关闭吸附"'):''}${button('add','＋ 空间')}${button('upload','导入')}</div>${pen&&plan.strokes?.length?button('stroke-space','将上一笔闭合为空间','class="studio-stroke-convert"'):''}${stroke&&!pen&&!drawing&&view==='plan'?`<div class="studio-object-tools studio-stroke-tools"><span>已选手绘线</span>${button('selected-stroke-space','闭合为空间')}${button('stroke-delete','删除笔迹')}</div>`:''}${drawing?drawingTools():''}${space&&!drawing&&!pen?`<div class="studio-object-tools"><label>名称<input id="studio-space-name" value="${esc(label(space))}" maxlength="80"></label>${view==='axon'?`<label>高度 / m<input id="studio-space-height" type="number" min="1" max="30" step="0.01" value="${space.height}"></label>`:`<label>面积 / ㎡<input id="studio-space-area" type="number" min="0.25" max="1000000" step="0.01" value="${round(areaOf(space))}" ${polygon?'readonly':''}></label>`}${button('duplicate','复制')}${polygon?'':button('rotate','旋转90°')}${button('remove','删除')}${button('drawer','精确属性','data-panel="properties"')}</div>`:''}<p class="studio-canvas-help">${view==='axon'?'空白处拖动旋转 · 右键拖动平移 · 滚轮缩放 · 拖顶面拉伸（Shift 可旋转）':pen?'按住并移动绘制一笔，松开保存 · Esc 返回选择':drawing?'点选顶点，点击起点或“闭合轮廓”完成。Esc 取消。':polygon?'拖动顶点修改轮廓 · 拖动空间移动 · Ctrl/Cmd+Z 撤销':stroke?'拖动笔迹移动 · 方向键微调 · Delete 删除 · 闭合为空间可拉伸':'空白处拖动平移 · 点选笔迹或空间 · Ctrl/Cmd+Z 撤销'}</p></main>${drawer?`<aside class="studio-drawer"><div class="studio-drawer-title"><h2>${{requirements:'需求与指标',viewpoints:'已存视角',underlay:'描图底图',materials:'项目材料',process:'设计过程',discussion:'围绕作品讨论',properties:'选中对象',share:'保存并邀请',more:'项目工具'}[drawer]||'工具'}</h2>${button('close-drawer','×','aria-label="关闭侧栏"')}</div>${drawerBody(p,w,o,space,metrics,label)}</aside>`:''}</div><input type="file" id="studio-file-input" accept=".skp,.pdf,.png,.jpg,.jpeg" hidden>${comparison?comparisonPanel(w):''}</div>`}
 function drawerBody(p,w,o,s,m,label){if(drawer==='requirements')return requirementPanel(p,w,o,m);if(drawer==='underlay')return underlay.panel();if(drawer==='viewpoints')return viewpointPanel();if(drawer==='materials')return `<p>上传后自动保留文件名和来源，可选择用于本次对话。</p>${button('upload','＋ 上传材料')}<div class="studio-file-list">${p.files.map(f=>`<article><button data-action="studio-open-file" data-id="${f.id}"><b>${esc(f.name)}</b><small>${f.type.toUpperCase()} · ${(f.size/1048576).toFixed(1)} MB</small></button><label><input type="checkbox" data-studio-file="${f.id}" ${files().has(f.id)?'checked':''}>用于对话</label>${['pdf','jpg','png'].includes(f.type)?button('edit-requirement','引用为需求','data-file="'+esc(f.id)+'"'):''}${f.extractedText?'<small>含前10页内浏览器提取文字，需核对原件。</small>':''}</article>`).join('')||'<p>还没有材料，可以直接开始画。</p>'}</div>`;
 if(drawer==='process')return `<p>设计过程随材料和操作逐步积累，随时补充，无需按顺序填表。</p>${DESIGN_STAGES.map(stage=>`<a class="studio-process-link" href="#/process/${p.id}/${stage.id}"><span>0${stage.id}</span><b>${stage.name}</b><small>${w.stages[stage.id-1].status==='idle'?'可后补':'已有记录'} ↗</small></a>`).join('')}<a class="btn text" href="#/board/${p.id}">查看材料看板 →</a>`;
 if(drawer==='discussion')return `<p>真实教师、同伴与使用者通过评审室围绕版本提问。AI 模拟建议与真人反馈分别保存。</p>${button('drawer','保存版本并邀请','data-panel="share"')}<a class="btn text" href="#/collaboration">打开评审室 →</a>${p.feedback.slice(0,8).map(f=>`<article class="studio-feedback"><small>${esc(f.source)} · ${esc(f.status)}</small><h3>${esc(f.title)}</h3><p>${esc(f.suggestion)}</p><a href="#/reviews">回应与定位 →</a></article>`).join('')}`;
 if(drawer==='properties')return s?`<h3>${esc(label(s))}</h3><p>${isPolygon(s)?'在平面拖动顶点可调整轮廓。此处可修改位置和高度。':'修改尺寸与位置，面积会自动计算。'}</p><form id="studio-properties-form" data-id="${s.id}" data-project="${p.id}">${[['x','X / m',0,1000],['y','Y / m',0,1000],['width','宽 / m',.5,1000],['depth','深 / m',.5,1000],['height','高 / m',1,30]].filter(([k])=>!isPolygon(s)||!['width','depth'].includes(k)).map(([k,l,min,max])=>`<label>${l}<input name="${k}" type="number" min="${min}" max="${max}" step="0.01" value="${k==='height'?s.height:boundsOf(s)[k]}" required></label>`).join('')}<button class="btn primary" type="submit">应用</button></form><form id="studio-edit-edge" data-id="${s.id}" data-option="${o.id}" data-project="${p.id}">${edgeFields(s)}<button type="submit">应用边长</button></form><form id="studio-assign-requirement" data-id="${s.id}" data-project="${p.id}" data-option="${o.id}">
 <label>关联功能<select name="programId">${w.program.map(row=>`<option value="${esc(row.id)}" ${row.id===s.programId?'selected':''}>${esc(row.name)}${row.spec?.source?' · 有任务书来源':''}</option>`).join('')}</select></label>
 <button type="submit">更新关联</button></form>`:'<p>在平面画布上点选空间，再查看或修改属性。</p>';
 if(drawer==='share')return `<p>将当前方案、材料与过程保存为固定版本，再邀请各方讨论。</p><form id="studio-share-form" data-project="${p.id}"><label>这一版主要改了什么？（可稍后补充）<textarea name="note" maxlength="3000" rows="4" placeholder="写一句关键变化或希望讨论的问题。"></textarea></label><button type="submit" class="btn primary">保存版本并创建评审室</button></form><a class="btn text" href="#/collaboration">查看已有讨论 →</a>`;
 return `<div class="studio-more-links"><a href="#/home">工作台首页 →</a><a href="#/finals">最终评审 →</a><a href="#/layout/${p.id}/${o?.id||''}">详细功能与布局工具 →</a><a href="#/workspace/${p.id}">图纸与真实模型 →</a><a href="#/archive">版本与导出 →</a><a href="#/course">课程任务 →</a><a href="#/projects">我的项目 →</a><button data-action="studio-save">保存 / 重试保存</button><button data-action="studio-new-project">新建空白项目</button></div><form id="studio-canvas-form"><label>画布宽 / m<input type="number" name="width" value="${o?.plan?.width||30}" min="1" max="1000" step="0.5" required></label><label>画布深 / m<input type="number" name="depth" value="${o?.plan?.depth||20}" min="1" max="1000" step="0.5" required></label><button type="submit" class="btn secondary">调整画布</button></form>`}
 function drawingTools(){
   return `<div class="studio-object-tools studio-draw-tools"><span>已放置 ${drawing.points.length} 个顶点</span>${button('close-polygon','闭合轮廓',drawing.points.length<3?'disabled':'')}${button('cancel-polygon','取消绘制')}
     ${drawing.points.length?`<form id="studio-next-edge"><label>方向 °<input id="studio-edge-angle" name="angle" type="number" step="any" value="${directionAngle}" required></label><label>下一边 / m<input name="meters" type="number" min="0.01" max="1500" step="0.01" required></label><button type="submit">添加顶点</button></form>`:''}</div>`;
 }
 function requirementPanel(p,w,o,metrics){
   const issues=planIssues(o?.id||'',metrics);
   const row=w.program.find(item=>item.id===requirementEdit)||{};
   const selected=locatedIssue?.optionId===o?.id?locatedIssue.key:'';
   return `${button('edit-requirement','＋ 新需求')}
     ${requirementEdit!==null?`<form id="studio-requirement-form" data-project="${esc(p.id)}" data-id="${esc(row.id)}">
       ${requirementFields(row,p.files,requirementSource)}
       <button type="submit">保存需求</button>${button('cancel-requirement','取消')}</form>`:''}
     <h3>功能清单</h3>
     ${metrics.requirements.map(r=>`<article class="studio-requirement-row" id="requirement-${esc(r.id)}">
       <b>${esc(r.name)}</b><p>${requirementDescription(w.program.find(row=>row.id===r.id),p.files)}</p>
       <p>已放 ${r.placed} / ${r.required} 个 · 已布置 ${r.actualArea} ㎡</p>
       ${button('edit-requirement','编辑','data-id="'+esc(r.id)+'"')}${button('place-requirement','放置一个','data-id="'+esc(r.id)+'"')}
     </article>`).join('')||'<p>可以引用任务书，或手工记录需求。</p>'}
     <h3>本方案待核对</h3>${requirementIssuesMarkup(issues,planOf(o),w.program,'studio',selected)}`;
 }
 function locateIssue(key){
   const p=project(),o=currentOption();
   if(!o)return;
   const issue=planIssues(o.id,planMetrics(o.plan,p.workflow.program,p.workflow.relationships)).find(item=>item.key===key);
   if(!issue)return;
   locatedIssue={optionId:o.id,key};
   view='plan';pen=false;drawing=null;selectedStroke='';mobile='canvas';
   const box=locatedBounds(o.plan,issue.spaceIds);
   if(box){
     zoom=Math.max(.2,Math.min(6,(o.plan.width+3.6)/(box.width+4),(o.plan.depth+3.6)/(box.depth+4)));
     panX=box.x+box.width/2-o.plan.width/2;panY=box.y+box.depth/2-o.plan.depth/2;
   }
   render();
   if(!box&&issue.programId)document.getElementById('requirement-'+issue.programId)?.scrollIntoView({block:'nearest'});
 }
 function viewpointPanel(){
   const option=currentOption();
   const available=option?.viewpoints||[];
   return `<form id="studio-save-viewpoint" class="studio-viewpoint-form">
      <label>视角名称<input name="name" maxlength="60" placeholder="例如：入口平面" required></label>
      <button type="submit" ${!option||available.length>=12?'disabled':''}>保存当前视角</button></form>
      ${available.length?available.map(entry=>`<div class="studio-viewpoint-row">${button('open-viewpoint',esc(entry.name)+' · '+(entry.kind==='plan'?'平面':'体块'),'data-id="'+entry.id+'"')}${button('remove-viewpoint','移除','data-id="'+entry.id+'"')}</div>`).join(''):'<p>保存的视角可在重开项目后使用。</p>'}`;
 }
 function openComparison(){
   const options=project()?.workflow?.options||[];
   const left=currentOption(),right=options.find(item=>item.id!==left?.id);
   if(!left||!right)return;
   comparison={left:left.id,right:right.id,mode:view,camera:{...massCamera()},focused:-1};
   render();
   document.querySelector('[data-action="studio-close-compare"]')?.focus();
 }
 function comparisonPanel(w){
   const a=w.options.find(item=>item.id===comparison.left),b=w.options.find(item=>item.id===comparison.right);
   if(!a||!b)return '';
   const choices=(value,exclude)=>w.options.filter(option=>option.id!==exclude).map(option=>
     `<option value="${esc(option.id)}" ${value===option.id?'selected':''}>${esc(option.title)}</option>`).join('');
   return `<section class="studio-comparison" role="dialog" aria-modal="true" aria-label="方案对照">
     <div class="studio-compare-controls">
     <h2>方案对照</h2>
     <label>左侧<select id="studio-compare-left">${choices(a.id,b.id)}</select></label>
     <label>右侧<select id="studio-compare-right">${choices(b.id,a.id)}</select></label>
     ${button('compare-view','平面','data-value="plan" aria-pressed="'+(comparison.mode==='plan')+'"')}
     ${button('compare-view','体块','data-value="axon" aria-pressed="'+(comparison.mode==='axon')+'"')}
     ${button('close-compare','关闭')}</div>
     ${optionComparison(a,b,w.program,w.relationships,{...comparison,interactive:true})}
     <form id="studio-compare-choice">
     <label>继续发展<select name="optionId">${[a,b].map(option=>`<option value="${esc(option.id)}" ${option.id===w.selectedOptionId?'selected':''}>${esc(option.title)}</option>`).join('')}</select></label>
     <label>选择理由<textarea name="reason" rows="2" maxlength="3000" required>${esc(w.choiceReason)}</textarea></label>
     <button type="submit">记录取舍</button></form>
   </section>`;
 }
 async function saveViewpoint(name){
   const axis=massCamera();
   const camera=view==='plan'?{zoom,panX,panY}:{...axis,yaw:Math.atan2(Math.sin(axis.yaw),Math.cos(axis.yaw))};
   await mutate([{type:'save_viewpoint',viewpoint:{id:crypto.randomUUID(),name,kind:view,camera}}],'保存视角');
 }
 function openViewpoint(id){
   const entry=currentOption()?.viewpoints?.find(item=>item.id===id);
   if(!entry)return;
   view=entry.kind;pen=false;drawing=null;
   if(view==='plan')({zoom,panX,panY}=entry.camera);
   else Object.assign(massCamera(),entry.camera);
   render();
 }
 async function closePolygon(){
   const draft=drawing;
   if(!draft||draft.points.length<3||draft.closing)return;
   draft.closing=true;
   try{
     await mutate([{type:'add_polygon',vertices:draft.points}],'绘制多边形',false,()=>{if(drawing===draft)drawing=null});
   }finally{draft.closing=false}
 }
 async function addVertex(vertex) {
   if(!drawing||drawing.closing)return;
   const {width,depth}=planOf(currentOption()), [x,y]=vertex;
   if(x<0||y<0||x>width||y>depth)throw Error('顶点超出了画布。');
   const points=drawing.points;
   const index=points.findIndex(([px,py])=>px===x&&py===y);
   if(index===0&&points.length>=3)return closePolygon();
   if(index>=0)throw Error('这个位置已有顶点。');
   if(points.length>=MAX_VERTICES)throw Error('顶点已达上限，请闭合轮廓。');
   points.push(vertex);render();
 }
 function boundedVertex(point,plan,svg,event,editing){
   const outlines=plan.spaces.map(space=>({
     points:footprintOf(space),closed:true,excluded:space.id===editing?.id?editing.vertexIndex:undefined
   }));
   if(drawing?.points.length)outlines.unshift({points:drawing.points,closed:false});
   const result=snapPlanPoint([point.x,point.y],{
     outlines,previous:drawing?.points.at(-1) || (editing?.points && editing.points.at(editing.vertexIndex-1)),
     radius:8/Math.abs(svg.getScreenCTM().a),enabled:snapping&&!event.altKey
   });
   const [x,y]=result.point;
   result.point=[Math.max(0,Math.min(plan.width,x)),Math.max(0,Math.min(plan.depth,y))];
   return result;
 }
 function polygonPreview(svg){
   const points=drawing.points;
   const preview=document.createElementNS(svg.namespaceURI,'g');
   preview.setAttribute('pointer-events','none');
   preview.innerHTML=`<polyline points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="#365f7e" stroke-width=".14"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="${i===0?.34:.21}" fill="#365f7e" stroke="white" stroke-width=".08"/>`).join('')}`;
   svg.append(preview);
 }
 function showSnap(svg,result,start) {
   let guide=svg.querySelector('.studio-snap-guide');
   if(!guide){
     guide=document.createElementNS(svg.namespaceURI,'g');
     guide.setAttribute('class','studio-snap-guide');
     guide.setAttribute('pointer-events','none');
     svg.append(guide);
   }
   const [x,y]=result.point;
   const length=start?round(Math.hypot(x-start[0],y-start[1]))+' m':'';
   guide.innerHTML=`${start?`<line x1="${start[0]}" y1="${start[1]}" x2="${x}" y2="${y}" stroke-dasharray=".22 .15"/>`:''}${result.kind?`<circle cx="${x}" cy="${y}" r=".2"/>`:''}<text x="${x+.28}" y="${y-.28}">${[result.kind,length].filter(Boolean).join(' · ')}</text>`;
 }
 function viewport(){const svg=document.querySelector('[data-plan-canvas]'),plan=planOf(currentOption());if(!svg)return;const width=(plan.width+3.6)/zoom,depth=(plan.depth+3.6)/zoom;svg.setAttribute('viewBox',[plan.width/2+panX-width/2,plan.depth/2+panY-depth/2,width,depth].join(' '))}
 function mount(){viewport();const input=document.querySelector('#studio-chat-input');input?.addEventListener('input',()=>draft=input.value);input?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();input.form.requestSubmit()}});const logEl=document.querySelector('#studio-chat-log');if(logEl)logEl.scrollTop=logEl.scrollHeight;document.querySelector('#studio-project-name')?.addEventListener('change',async e=>{try{await mutate([{type:'rename_project',name:e.target.value}],'重命名项目')}catch(error){toast(error.message);render()}});document.querySelector('#studio-space-name')?.addEventListener('change',e=>mutate([{type:'update_space',targetId:selected,name:e.target.value}],'重命名空间').catch(e=>toast(e.message)));document.querySelector('#studio-space-height')?.addEventListener('change',e=>mutate([{type:'update_space',targetId:selected,height:Number(e.target.value)}],'修改体块高度').catch(error=>{toast(error.message);render()}));document.querySelector('#studio-space-area')?.addEventListener('change',e=>mutate([{type:'update_space',targetId:selected,area:Number(e.target.value)}],'调整面积').catch(e=>toast(e.message)));document.querySelector('#studio-file-input')?.addEventListener('change',e=>addFile(e.target.files[0]));document.querySelectorAll('[data-studio-file]').forEach(el=>el.addEventListener('change',()=>{if(el.checked){if(files().size>=3){el.checked=false;toast('每次对话最多关联3份材料，请先移除一份。');return}files().add(el.dataset.studioFile)}else files().delete(el.dataset.studioFile)}));const canvas=document.querySelector('#studio-canvas');canvas?.addEventListener('dragover',e=>{e.preventDefault()});canvas?.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files[0])addFile(e.dataTransfer.files[0])});
 const svg=document.querySelector('[data-plan-canvas]');
 const editedSpace=currentOption()?.plan.spaces.find(space=>space.id===selected);
 mountEdgeEditor(document.querySelector('#studio-edit-edge'),editedSpace,planOf(currentOption()),(points,i)=>{
   if(!svg)return;
   svg.querySelector('.studio-edge-preview')?.remove();
   svg.querySelector('.studio-snap-guide')?.remove();
   if(!points)return;
   const preview=document.createElementNS(svg.namespaceURI,'polygon');
   preview.setAttribute('points',points.map(point=>point.join(',')).join(' '));
   preview.setAttribute('class','studio-edge-preview');
   svg.append(preview);
   showSnap(svg,{point:points[(i+1)%points.length],kind:'预览'},points[i]);
 });
 mountRequirementEditor(document.querySelector('#studio-requirement-form'),project()?.files||[],project()?.workflow?.program||[]);
 for(const side of ['left','right']){
   document.querySelector('#studio-compare-'+side)?.addEventListener('change',event=>{
     comparison[side]=event.target.value;comparison.focused=-1;render();
   });
 }
 const disposeUnderlay=underlay.mount(svg);
 let drag=null, cancelPen=null, cancelStroke=null;
 if(svg)mountPlanTouchNavigation(svg,{
   interrupt(){
     cancelPen?.(true);cancelStroke?.();
     svg.querySelector('.studio-snap-guide')?.remove();
     if(drag?.id){
       const space=planOf(currentOption()).spaces.find(space=>space.id===drag.id);
       const group=svg.querySelector('[data-space-id="'+drag.id+'"]');
       if(group&&space){
         const {x,y}=boundsOf(space);
         group.setAttribute('transform',`translate(${x} ${y})`);
         if(drag.resizing){
           group.querySelector('rect').setAttribute('width',space.width);
           group.querySelector('rect').setAttribute('height',space.depth);
         }
         if(drag.vertexStart){
           group.querySelector('polygon').setAttribute('points',footprintOf(space).map(([px,py])=>[px-x,py-y].join(',')).join(' '));
           const handle=group.querySelector('[data-vertex-index="'+drag.vertexIndex+'"]');
           handle.setAttribute('cx',drag.vertexStart[0]-x);
           handle.setAttribute('cy',drag.vertexStart[1]-y);
         }
       }
     }
     drag=null;
   },
   navigate(before,after){
     const anchor=new DOMPoint(before.x,before.y).matrixTransform(svg.getScreenCTM().inverse());
     zoom=Math.max(1,Math.min(6,zoom*after.distance/before.distance));
     viewport();
     const moved=new DOMPoint(after.x,after.y).matrixTransform(svg.getScreenCTM().inverse());
     panX+=anchor.x-moved.x;panY+=anchor.y-moved.y;viewport();
   },render
 });
 const key=async e=>{
   if(e.isComposing||(e.key!=='Escape'&&e.target.matches('input,textarea,select')))return;
   try{
     if(e.key==='Escape'){
       if(comparison){comparison=null;render();return}
       if(proposed&&!applying){proposed=null;render();return}
       const interrupted=drag;drag=null;
       if(interrupted&&svg?.hasPointerCapture(interrupted.pointerId))svg.releasePointerCapture(interrupted.pointerId);
       document.querySelector('svg[data-gesture-route]')?.removeAttribute('data-gesture-route');
       drawing=null;pen=false;selected='';selectedStroke='';render();return;
     }
     if(comparison)return;
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
   mountMassOrbit(massCanvas,planOf(currentOption()),project().workflow?.program||[],massCamera(),()=>selected,render);
   mountExtrusion(massCanvas,planOf(currentOption()),project().workflow?.program||[],{
     select:id=>{selected=id;selectedStroke=''},render,camera:massCamera(),
     commit:(id,height)=>guarded(mutate([{type:'update_space',targetId:id,height}],'拉伸体块'))
   });
 }
 if(svg&&pen){
   cancelPen=mountPen(svg,planOf(currentOption()),points=>guarded(mutate([{type:'draw_stroke',points}],'自由手绘')),render);
 }else if(svg){
   if(drawing)polygonPreview(svg);
   else cancelStroke=mountStrokeSelection(svg,planOf(currentOption()),{
     select:id=>{selectedStroke=id;selected=''},render,
     commit:(id,dx,dy)=>guarded(mutate([{type:'move_stroke',targetId:id,dx,dy}],'移动笔迹'))
   });
   const point=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
   svg.addEventListener('pointerdown',e=>{
     if(e.button!==0||drag||!e.isPrimary)return;
     e.preventDefault();
     const pointerId=e.pointerId;
     if(drawing)drag={pointerId,mark:true,clientX:e.clientX,clientY:e.clientY};
     else{
       locatedIssue=null;selectedStroke='';
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
     svg.dataset.gestureRoute=location.hash;
     svg.setPointerCapture(pointerId);
   });
   svg.addEventListener('pointermove',e=>{
     if(drawing&&(!drag||drag.mark)){
       const last=drawing.points.at(-1);
       const result=boundedVertex(point(e),planOf(currentOption()),svg,e);
       if(last){
         const angle=round(Math.atan2(result.point[1]-last[1],result.point[0]-last[0])*180/Math.PI);
         const input=document.querySelector('#studio-edge-angle');
         if(input&&document.activeElement!==input)input.value=directionAngle=angle;
       }
       showSnap(svg,result,last);
       return;
     }
     if(!drag||drag.pointerId!==e.pointerId)return;
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
       const result=boundedVertex({x:vx+dx,y:vy+dy},p,svg,e,drag);
       drag.vertexPoint=result.point;
       showSnap(svg,result,drag.points.at(drag.vertexIndex-1));
       const [x,y]=drag.vertexPoint;
       const points=drag.points.map((v,i)=>i===drag.vertexIndex?drag.vertexPoint:v);
       g.querySelector('polygon').setAttribute('points',points.map(([x,y])=>[x-s.x,y-s.y].join(',')).join(' '));
       const handle=g.querySelector('[data-vertex-index="'+drag.vertexIndex+'"]');
       handle.setAttribute('cx',x-s.x);
       handle.setAttribute('cy',y-s.y);
     }else if(drag.resizing){
       const result=boundedVertex({x:s.x+s.width+dx,y:s.y+s.depth+dy},p,svg,e,{id:drag.id,vertexIndex:2});
       drag.width=round(Math.max(.5,result.point[0]-s.x));
       drag.depth=round(Math.max(.5,result.point[1]-s.y));
       showSnap(svg,result,[s.x,s.y]);
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
     releaseGesture(svg,render);
     if(d.panning)return;
     try{
       if(d.mark){
         if(!drawing||drawing.closing||Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)>8)return;
         const plan=planOf(currentOption()), at=point(e);
         if(at.x<0||at.y<0||at.x>plan.width||at.y>plan.depth)return;
         await addVertex(boundedVertex(at,plan,svg,e).point);return;
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
   function cancelDrag(e){
     if(drag?.pointerId!==e.pointerId)return;
     drag=null;
     releaseGesture(svg,render);
     render();
   }
   svg.addEventListener('pointercancel',cancelDrag);
   svg.addEventListener('lostpointercapture',cancelDrag);
 }
 cleanup=()=>{disposeUnderlay();document.removeEventListener('keydown',key);drag=null}}
 async function addFile(file){if(!file)return;if(uploading)return;uploading=true;const pId=project()?.id;try{await ensure();const f=await upload(file);if(project()?.id!==pId)return;if(files().size<3)files().add(f.id);else toast('材料已保存；对话最多关联3份，可在材料中切换。');log('notice',f.name+' 已加入。'+(f.extractedText?'已提取前10页内可读取文字（最多12000字符），可让助手整理需求；请核对原件。':f.type==='pdf'?'未读取到足够文字，扫描件可在图纸区选页转图。':'可选择它作为对话依据。'));await save();drawer='materials'}catch(error){toast(error.message)}finally{uploading=false;render()}}
 async function createPreview(entry,mode){
   if(project()?.id!==entry.projectId||previewStale(entry))throw Error('工作稿已变化，请基于当前方案重新发起建议。');
   let result;
   if(entry.run){
     result=await api('/api/ai/runs/'+entry.run.id+'/preview',{method:'POST',headers:{'If-Match':etag()},
       body:JSON.stringify({optionId:entry.context.optionId,mode})});
   }else{
     const ids=[];
     const {preview}=previewStudioActions(project(),entry.actions,entry.context,mode,()=>{
       const id=crypto.randomUUID();ids.push(id);return id;
     });
     result={preview,ids};
   }
   if(project()?.id!==entry.projectId||previewStale(entry))throw Error('工作稿已变化，请基于当前方案重新发起建议。');
   proposed={...entry,...result,mode};
   if(activeOption===entry.context.optionId){view='plan';pen=false;drawing=null;mobile='canvas'}
 }
 async function setPreviewMode(mode){
   const entry=currentPreview();
   if(!entry||busy||applying)return;
   busy=true;render();
   try{await createPreview(entry,mode)}
   finally{busy=false;render()}
 }
 async function openRunPreview(run){
   if(!run.output?.actions?.length||busy||applying)return;
   const entry={run,projectId:run.projectId,context:run.assistantSelection,base:projectKey()};
   busy=true;render();
   try{await save();await createPreview(entry,'current')}
   finally{busy=false;render()}
 }
 async function applyPreview(){
   const entry=currentPreview();
   if(!entry||busy||applying)return;
   applying=true;render();
   try{
     await queue.catch(()=>{});
     if(project()?.id!==entry.projectId||previewStale(entry))throw Error('工作稿已变化，请重新发起建议。');
     const before=captureDraft(project());
     let receipt;
     if(entry.run){
       const applied=await api('/api/ai/runs/'+entry.run.id+'/apply',{method:'POST',headers:{'If-Match':etag()},
         body:JSON.stringify({proposalId:entry.proposalId})});
       replaceState(applied.state,applied.etag);
       receipt=applied.assistantResult;
     }else{
       let index=0;
       const result=previewStudioActions(project(),entry.actions,entry.context,entry.mode,()=>entry.ids[index++]);
       if(index!==entry.ids.length)throw Error('预览需要重新生成。');
       updateProject(result.project);receipt=result.preview;
     }
     proposed=null;
     if(project()?.id!==entry.projectId)return;
     activeOption=receipt.optionId;
     selected=receipt.createdIds.at(-1)||receipt.changedIds.filter(id=>currentOption()?.plan.spaces.some(s=>s.id===id)).at(-1)||'';
     if(activeOption!==entry.context.optionId)location.hash='#/studio/'+entry.projectId+'/'+activeOption;
     history().record(before,captureDraft(project()),entry.run?'AI 设计修改':'对话操作');
     log('notice',receipt.summary,entry.run?.id,entry.run?'model':'local');
     await save();
   }finally{applying=false;render()}
 }
 async function send(message){
   if(!message.trim()||busy||uploading||applying)return;
   await ensure();
   const projectId=project().id,context=selection(),base=projectKey();
   proposed=null;draft='';log('user',message);
   const intent=localStudioIntent(message,project(),context);
   if(intent?.command==='undo')return step();
   if(intent?.command==='redo')return step(true);
   if(intent?.command==='metrics')return metricsReply();
   if(intent){
     if(intent.clarify)log('assistant',intent.clarify);
     else await createPreview({actions:intent.actions,projectId,context,base},'current');
     await save();render();return;
   }
   busy=true;render();let runId='';
   try{
     await save();
     if(project()?.id!==projectId||projectKey()!==base)throw Error('工作稿已变化，请重新发起建议。');
     const p=project(),messages=(p.workflow.assistantLog||[]).filter(m=>['user','assistant'].includes(m.role))
       .slice(-7,-1).map(m=>({role:m.role,text:m.text.slice(0,2000)}));
     const {run}=await api('/api/ai/generate',{method:'POST',headers:{'If-Match':etag()},
       body:JSON.stringify({projectId,requestId:crypto.randomUUID(),kind:'assistant',assistantInput:message,
         assistantSelection:context,assistantMessages:messages,fileIds:[...files()].filter(id=>p.files.some(f=>f.id===id)).slice(0,3),views:[]})});
     runId=run.id;
     if(run.status!=='succeeded')throw Error('任务尚未完成，请查看生成记录。');
     if(project()?.id!==projectId)return;
     if(run.output.actions.length){await save();await createPreview({run,projectId,context,base},'current')}
     const reply=[run.output.message,...run.output.questions].filter(Boolean).join('\n');
     if(reply)log('assistant',reply,runId,'model');
     await save();
   }catch(error){
     if(project()?.id===projectId){
       log('assistant',error.message+(runId?' 本次建议没有应用。':' 未自动重试。'),runId,'model');
       try{await save()}catch{}
     }
   }finally{busy=false;render()}
 }
 async function metricsReply(){await ensure();const w=project().workflow,m=planMetrics(currentOption().plan,w.program,w.relationships||[]);highlight=true;log('assistant','当前已布置 '+m.area+'㎡、'+m.placed+' 个空间。发现 '+m.overlaps.length+' 组空间重叠、'+m.outside.length+' 个越界。'+(m.overlaps.length||m.outside.length?'问题已在画布标出。':'目前没有这些几何冲突。')+'\n这是几何检查，空间使用与专业要求仍需结合材料判断。');await save();render()}
 async function action(a,b){try{if(await underlay.action(a))return;underlay.cancel();if(a==='studio-drawer'&&b.dataset.panel==='underlay'){view='plan';pen=false;drawing=null;}if(a==='studio-accept-preview'){await applyPreview();return}
 if(a==='studio-discard-preview'){if(!applying&&!busy){proposed=null;render()}return}
 if(a==='studio-preview-mode'){await setPreviewMode(b.dataset.value);return}
 if(a==='studio-compare'){openComparison();return}
 if(a==='studio-close-compare'){comparison=null;render();return}
 if(a==='studio-compare-view'){comparison.mode=b.dataset.value;render();return}
 if(a==='studio-compare-space'){comparison.focused=Number(b.dataset.id);render();return}
 if(a==='studio-locate-issue'){locateIssue(b.dataset.id);return}
 if(a==='studio-edit-requirement'){drawer='requirements';requirementEdit=b.dataset.id||'';requirementSource=b.dataset.file||'';render();return}
 if(a==='studio-cancel-requirement'){requirementEdit=null;render();return}
 if(a==='studio-place-requirement'){await mutate([{type:'place_requirement',programId:b.dataset.id}],'按需求放置空间');return}
 if(a==='studio-open-viewpoint'){openViewpoint(b.dataset.id);return}if(a==='studio-remove-viewpoint'){await mutate([{type:'remove_viewpoint',targetId:b.dataset.id}],'移除视角');return}if(a==='studio-snap'){snapping=!snapping;render();return}if(a==='studio-mass-reset'){Object.assign(massCamera(),{yaw:Math.PI/4,pitch:Math.PI/6,zoom:1,panX:0,panY:0});render();return}if(a==='studio-toggle-assistant'){assistantClosed=!assistantClosed;render();return}if(a==='studio-save'){await save();toast('已保存至云端。');return}if(a==='studio-new-project'){await quickCreate();return}if(a==='studio-upload'){document.querySelector('#studio-file-input').click();return}if(a==='studio-drawer'){drawer=drawer===b.dataset.panel?'':b.dataset.panel;render();return}if(a==='studio-close-drawer'){drawer='';render();return}if(a==='studio-mobile'){mobile=b.dataset.value;render();return}if(a==='studio-prompt'){draft=b.dataset.text||'';mobile='chat';render();document.querySelector('#studio-chat-input')?.focus();return}if(a==='studio-detach'){files().delete(b.dataset.id);render();return}if(a==='studio-open-file'){location.hash='#/workspace/'+project().id;document.dispatchEvent(new CustomEvent('studio-open-material',{detail:{id:b.dataset.id}}));return}if(a==='studio-run'){await showRun(b.dataset.id);return}if(a==='studio-selected-stroke-space'){if(selectedStroke)await mutate([{type:'stroke_to_space',targetId:selectedStroke}],'手绘线建面');return}if(a==='studio-stroke-delete'){if(selectedStroke)await mutate([{type:'delete_stroke',targetId:selectedStroke}],'删除笔迹');return}if(a==='studio-pen'){selectedStroke='';view='plan';drawing=null;selected='';pen=!pen;render();return}if(a==='studio-stroke-space'){const stroke=currentOption()?.plan.strokes?.at(-1);if(stroke)await mutate([{type:'stroke_to_space',targetId:stroke.id}],'手绘线建面',false,()=>{pen=false});return}if(a==='studio-view'){selectedStroke='';view=b.dataset.view;pen=false;if(view!=='plan')drawing=null;render();return}if(a==='studio-zoom-in'||a==='studio-zoom-out'){zoom=Math.max(1,Math.min(6,zoom*(a==='studio-zoom-in'?1.4:1/1.4)));viewport();return}if(a==='studio-fit'){zoom=1;panX=0;panY=0;viewport();return}if(a==='studio-select'||a==='studio-cancel-polygon'){selectedStroke='';pen=false;selected='';drawing=null;view='plan';render();return}if(a==='studio-draw-polygon'){selectedStroke='';pen=false;if(drawing)return;view='plan';selected='';drawer='';drawing={optionId:activeOption,points:[],closing:false};render();return}if(a==='studio-close-polygon'){await closePolygon();return}if(a==='studio-undo')return await step();if(a==='studio-redo')return await step(true);if(a==='studio-metrics')return await metricsReply();if(a==='studio-add'||a==='studio-preset')await mutate([{type:'add_space',name:b.dataset.name||'空间 '+((currentOption()?.plan.spaces.length||0)+1),area:Number(b.dataset.area)||20}],'添加空间',true);else if(a==='studio-clone')await mutate([{type:'duplicate_option'}],'复制方案');else if(a==='studio-grow'){if(!selected)return toast('先在画布上选中空间。');await mutate([{type:'update_space',targetId:selected,scale:1.1}],'放大空间')}else if(a==='studio-remove')await mutate([{type:'delete_space',targetId:selected}],'删除空间');else if(a==='studio-duplicate')await mutate([{type:'duplicate_space',targetId:selected}],'复制空间');else if(a==='studio-rotate'){const s=currentOption()?.plan.spaces.find(s=>s.id===selected);if(s)await mutate([{type:'update_space',targetId:selected,width:s.depth,depth:s.width}],'旋转空间')}}catch(error){toast(error.message)}}
 async function submit(form){if(await underlay.submit(form))return;if(form.id==='studio-chat-form'){const text=String(new FormData(form).get('message')||'').trim();try{await send(text)}catch(error){log('assistant',error.message);toast(error.message);render()}return}const d=Object.fromEntries(new FormData(form));if(form.dataset.project&&form.dataset.project!==project().id)throw Error('项目已切换，请重新操作。');if(form.id==='studio-compare-choice'){
   if(!comparison||![comparison.left,comparison.right].includes(d.optionId))throw Error('请重新选择比对方案。');
   await mutate([{type:'record_choice',optionId:d.optionId,compareWithId:d.optionId===comparison.left?comparison.right:comparison.left,
     reason:d.reason}],'保存方案取舍');
   toast('已保存方案选择与取舍。');
 }else if(form.id==='studio-assign-requirement'){
   if(form.dataset.option!==currentOption()?.id)throw Error('方案已切换，请重新选择空间。');
   await mutate([{type:'assign_requirement',targetId:form.dataset.id,programId:d.programId}],'关联功能需求');
 }else if(form.id==='studio-requirement-form'){
   const p=project();
   if(form.dataset.id&&!p.workflow?.program.some(row=>row.id===form.dataset.id))throw Error('需求已移除，请重新选择。');
   const requirement=readRequirementForm(form,form.dataset.id||crypto.randomUUID(),p.files);
   await mutate([{type:'upsert_requirement',requirement}],'保存功能需求',false,()=>{requirementEdit=null});
 }else if(form.id==='studio-save-viewpoint'){
   await saveViewpoint(d.name);
 }else if(form.id==='studio-next-edge'){
   if(!drawing?.points.length)return;
   directionAngle=Number(d.angle);
   const angle=directionAngle*Math.PI/180;
   await addVertex(endpointAtLength(drawing.points.at(-1),[Math.cos(angle),Math.sin(angle)],Number(d.meters)));
 }else if(form.id==='studio-edit-edge'){
   if(form.dataset.option!==currentOption()?.id)throw Error('方案已切换，请重新选择边。');
   const space=currentOption().plan.spaces.find(s=>s.id===form.dataset.id);
   if(!space)throw Error('该空间已移除。');
   await mutate([{type:'set_edge_length',targetId:space.id,expectedFootprint:JSON.parse(form.dataset.footprint),
     edgeIndex:Number(d.edgeIndex),meters:Number(d.meters)}],'调整边长');
 }else if(form.id==='studio-properties-form')await mutate([{type:'update_space',targetId:form.dataset.id,...Object.fromEntries(Object.entries(d).map(([k,v])=>[k,Number(v)]))}],'调整空间属性');else if(form.id==='studio-canvas-form'){await ensure();const before=captureDraft(project()),next=structuredClone(project());next.workflow.options.find(o=>o.id===activeOption).plan.width=Number(d.width);next.workflow.options.find(o=>o.id===activeOption).plan.depth=Number(d.depth);updateProject(next);history().record(before,captureDraft(project()),'调整画布');await save();render()}else if(form.id==='studio-share-form'){await ensure();await save();const p=project(),response=await api('/api/snapshots',{method:'POST',headers:{'If-Match':etag()},body:JSON.stringify({projectId:p.id,kind:'stage',label:(currentOption()?.title||'方案')+' · V'+(p.versions.length+1),note:d.note?.trim()||'阶段讨论稿；关键设计理由待学生补充。'})});replaceState(response.state,response.etag);const room=await api('/api/review-rooms',{method:'POST',body:JSON.stringify({projectId:p.id,versionId:response.versionId,title:p.name+' · 方案讨论'})});drawer='';location.hash='#/room/'+room.room.id}}
 function dispose(){cleanup?.();cleanup=null}
 return {page,mount,action,submit,dispose,openRunPreview,isBusy:()=>busy||applying};
}
