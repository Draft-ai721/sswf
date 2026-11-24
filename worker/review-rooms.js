import {createFinalSubmission,finalAiResult} from './final-submissions.js';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
class RoomError extends Error{constructor(message,status=400){super(message);this.status=status}}
const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(s);
const required=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw new RoomError('请填写有效内容，且不要超过长度限制。');return s.trim()};
async function read(b,k){const r=await b.get(k);return r?{value:await r.json(),etag:r.etag}:null}
const roomKey=id=>'review-rooms/'+id+'.json';
async function write(b,k,old,value){const r=await b.put(k,JSON.stringify(value),{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!r)throw new RoomError('讨论已在其他页面更新，请刷新后重试。',409);return r}
async function digest(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('')}
async function index(b,prefix,id){const k=prefix+'review-rooms.json';for(let i=0;i<5;i++){const old=await read(b,k);try{await write(b,k,old,[id,...(old?.value||[]).filter(x=>x!==id)].slice(0,100));return}catch(e){if(e.status!==409)throw e}}throw new RoomError('暂时无法登记评审室，请重试。',503)}
function access(room,user){if(room.owner===user)return 'owner';const member=room.members.find(m=>m.user===user);const invite=member&&room.invites.find(i=>i.id===member.inviteId);if(!invite||invite.revoked||Date.parse(invite.expiresAt)<=Date.now())throw new RoomError('未获得评审授权，或邀请已过期、已撤销。',403);return invite.role}
function present(room,role){return {...room,owner:undefined,ownerPrefix:undefined,members:undefined,invites:role==='owner'?room.invites.map(({tokenHash,...i})=>({...i,acceptedCount:room.members.filter(m=>m.inviteId===i.id).length})):undefined,role}}
export async function reviewRoomsApi(request,env,prefix,{readJson}){const u=new URL(request.url);if(!u.pathname.startsWith('/api/review-rooms'))return null;const b=env.BUCKET,user=request.headers.get('oai-authenticated-user-id'),email=(request.headers.get('oai-authenticated-user-email')||'').toLowerCase();
try{
 if(u.pathname==='/api/review-rooms'&&request.method==='GET'){const ids=(await read(b,prefix+'review-rooms.json'))?.value||[],rooms=[];for(const id of ids){const record=await read(b,roomKey(id));if(!record)continue;try{const role=access(record.value,user);rooms.push({id,title:record.value.title,projectName:record.value.version.snapshot.name,versionNumber:record.value.version.number,course:record.value.course?.name||'',createdAt:record.value.createdAt,role,kind:record.value.kind||'concept',verdict:record.value.verdict?.decision||'',comments:record.value.comments.length})}catch{}}return json({rooms})}
 if(u.pathname==='/api/review-rooms'&&request.method==='POST'){const data=await readJson(request,64000),state=await read(b,prefix+'state.json');
   if(data.kind==='final'){
     if(data.requestId){
       if(!valid(data.requestId))throw new RoomError('提交编号无效。');
       const existing=await read(b,roomKey(data.requestId));
       if(existing){
         if(existing.value.owner!==user||existing.value.kind!=='final')throw new RoomError('提交编号已使用。',409);
         await index(b,prefix,existing.value.id);
         return json({room:present(existing.value,'owner'),etag:existing.etag});
       }
     }
     const work=await createFinalSubmission(b,prefix,data,state?.value,message=>new RoomError(message));
     if(data.requestId)work.id=data.requestId;
     const room={...work,owner:user,ownerPrefix:prefix,members:[],invites:[],comments:[]};
     const saved=await write(b,roomKey(room.id),null,room);
     await index(b,prefix,room.id);
     return json({room:present(room,'owner'),etag:saved.etag},201);
   }
   const p=state?.value.projects.find(p=>p.id===data.projectId),v=p?.versions.find(v=>v.id===data.versionId);if(!v)throw new RoomError('请先保存并选择一个不可变阶段版本。',404);const id=crypto.randomUUID(),room={id,title:required(data.title,100),owner:user,ownerPrefix:prefix,projectId:p.id,course:structuredClone(state.value.course),version:structuredClone(v),members:[],invites:[],comments:[],createdAt:new Date().toISOString()};const r=await write(b,roomKey(id),null,room);await index(b,prefix,id);return json({room:present(room,'owner'),etag:r.etag},201)}
 if(u.pathname==='/api/review-rooms/accept'&&request.method==='POST'){const data=await readJson(request,4000);if(typeof data.token!=='string'||!/^[a-f0-9]{48}$/.test(data.token))throw new RoomError('邀请链接无效。',404);const tokenHash=await digest(data.token),ref=await read(b,'review-invites/'+tokenHash+'.json');if(!ref)throw new RoomError('邀请链接不存在。',404);const old=await read(b,roomKey(ref.value.roomId));if(!old)throw new RoomError('评审室不存在。',404);const room=old.value,invite=room.invites.find(i=>i.tokenHash===tokenHash);if(!invite||invite.revoked||Date.parse(invite.expiresAt)<=Date.now())throw new RoomError('邀请已过期或被撤销。',403);if(invite.email&&!email)throw new RoomError('此邀请绑定邮箱，请先由工作坊管理员确认你的账号身份。',403);if(invite.email&&invite.email!==email)throw new RoomError('此邀请仅限指定邮箱的登录账号使用。',403);if(room.owner!==user){room.members=room.members.filter(m=>m.user!==user);room.members.push({user,inviteId:invite.id,joinedAt:new Date().toISOString()});await write(b,roomKey(room.id),old,room)}await index(b,prefix,room.id);return json({roomId:room.id,kind:room.kind||'concept'})}
 const m=u.pathname.match(/^\/api\/review-rooms\/([a-zA-Z0-9-]{1,80})(?:\/(invites|revoke|comments|reply|resolve|verdict|files|models)(?:\/([a-zA-Z0-9-]{1,80}))?)?$/);if(!m)throw new RoomError('评审接口不存在。',404);const old=await read(b,roomKey(m[1]));if(!old)throw new RoomError('评审室不存在。',404);const room=old.value,role=access(room,user);
 if(!m[2]&&request.method==='GET'){
   const view=present(room,role);
   if(room.kind==='final')view.aiReview=await finalAiResult(b,room);
   return json({room:view,etag:old.etag});
 }
 if(['files','models'].includes(m[2])&&request.method==='GET'){const f=room.version.snapshot.files.find(f=>f.id===m[3])||room.comments.flatMap(c=>c.replies.flatMap(r=>r.files||[])).find(f=>f.id===m[3]);if(!f)throw new RoomError('材料不属于共享版本。',404);const isModel=m[2]==='models';if(isModel&&(!f.conversion?.resultId||f.conversion.status!=='ready'))throw new RoomError('此快照没有可用的模型转换结果。',404);const key=room.ownerPrefix+(isModel?'models/'+f.id+'/results/'+f.conversion.resultId+'.glb':'files/'+f.id);const obj=await b.get(key);if(!obj)throw new RoomError('材料不可用。',404);return new Response(obj.body,{headers:{'Content-Type':isModel?'model/gltf-binary':obj.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'private, no-store','Content-Disposition':(f.type==='skp'&&!isModel?'attachment':'inline')+'; filename="material.'+(isModel?'glb':f.type)+'"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}})}
 if(request.method!=='POST')throw new RoomError('不支持此操作。',405);if(request.headers.get('If-Match')!==old.etag)throw new RoomError('讨论已更新，请刷新评审室后重试。',409);const data=await readJson(request,64000);
 if(m[2]==='verdict'){
   if(room.kind!=='final'||role!=='reviewer')throw new RoomError('需要受邀教师权限。',403);
   if(!['已评阅','需补充','需修改'].includes(data.decision))throw new RoomError('请选择审查结论。');
   const author=decodeURIComponent(request.headers.get('oai-authenticated-user-name')||'')||'受邀教师';
   const verdict={decision:data.decision,text:required(data.text,4000),author,createdAt:new Date().toISOString()};
   if(data.decision!=='已评阅'){
     if(room.comments.length>=150)throw new RoomError('本场讨论已达到上限。');
     room.comments.push({id:crypto.randomUUID(),text:verdict.text,source:'project',status:'待回应',kind:'修改任务',author:'受邀教师',authorName:author,createdAt:verdict.createdAt,events:[],replies:[]});
   }
   room.verdict=verdict;
   room.verdicts=[...(room.verdicts||[]),verdict];if(room.verdicts.length>100)throw new RoomError('本场评语已达到上限。');
 }
 else if(m[2]==='invites'){if(room.kind==='final'&&data.role==='reviewer'&&data.perspective!=='教师')throw new RoomError('终评由受邀教师评阅。');if(role!=='owner')throw new RoomError('只有项目所有者可以创建邀请。',403);if(!['reviewer','viewer'].includes(data.role))throw new RoomError('邀请角色无效。');const boundEmail=String(data.email||'').trim().toLowerCase();if(boundEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(boundEmail))throw new RoomError('请输入有效的受邀邮箱。');if(data.role==='reviewer'&&!boundEmail)throw new RoomError('评审者邀请需要绑定邮箱。');if(room.invites.filter(i=>!i.revoked).length>=30)throw new RoomError('请先撤销不再使用的邀请。');const days=Number(data.days);if(![1,7,30].includes(days))throw new RoomError('请选择有效期限。');const token=Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join(''),tokenHash=await digest(token),invite={id:crypto.randomUUID(),tokenHash,role:data.role,email:boundEmail,perspective:['教师','同伴','使用者'].includes(data.perspective)?data.perspective:'教师',expiresAt:new Date(Date.now()+days*86400000).toISOString(),createdAt:new Date().toISOString(),revoked:false};room.invites.push(invite);const r=await write(b,roomKey(room.id),old,room);await write(b,'review-invites/'+tokenHash+'.json',null,{roomId:room.id});return json({room:present(room,role),etag:r.etag,inviteUrl:u.origin+'/#/invite/'+token},201)}
 else if(m[2]==='revoke'){if(role!=='owner')throw new RoomError('只有项目所有者可以撤销邀请。',403);const invite=room.invites.find(i=>i.id===data.inviteId);if(!invite)throw new RoomError('邀请不存在。',404);invite.revoked=true}
 else if(m[2]==='comments'){if(!['reviewer','owner'].includes(role))throw new RoomError('只读访客不能发表评审。',403);if(role==='owner')throw new RoomError('请由受邀评审者提出问题；项目所有者可回应。',403);if(room.comments.length>=150)throw new RoomError('此评审室讨论条数已达到上限。');const source=required(data.source,160);const paragraphIds=room.version.snapshot.report.split(/\n\s*\n/).filter(Boolean).map((_,i)=>'report-'+(i+1));const workflowIds=room.version.snapshot.workflow?[1,2,3,4,5,6].map(n=>'workflow-'+n):[];const optionIds=(room.version.snapshot.workflow?.options||[]).map(o=>'option-'+o.id);if(source!=='project'&&!optionIds.includes(source)&&!workflowIds.includes(source)&&!paragraphIds.includes(source)&&!room.version.snapshot.files.some(f=>f.id===source))throw new RoomError('所选位置不属于这个版本。');let point=null;if(data.point){const f=room.version.snapshot.files.find(f=>f.id===source);const coords=v=>Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e10);if(!f||f.type!=='skp'||!f.conversion?.resultId||!coords(data.point.position)||!coords(data.point.camera?.position)||!coords(data.point.camera?.target))throw new RoomError('模型定位数据无效。');point={position:data.point.position,camera:{position:data.point.camera.position,target:data.point.camera.target}}}let imagePoint=null;if(data.imagePoint){const f=room.version.snapshot.files.find(f=>f.id===source),v=data.imagePoint;const pdf=room.kind==='final'&&f?.type==='pdf'&&Number.isInteger(v.page)&&v.page>=1&&v.page<=2000;if(data.point||!f||(!pdf&&!['jpg','png'].includes(f.type))||!['x','y'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k])&&v[k]>=0&&v[k]<=1))throw new RoomError('图纸定位数据无效。');imagePoint={x:v.x,y:v.y,...(pdf?{page:v.page}:{})}}room.comments.push({id:crypto.randomUUID(),text:required(data.text,4000),task:String(data.task||'').slice(0,1000),source,point,imagePoint,authorName:decodeURIComponent(request.headers.get('oai-authenticated-user-name')||'').slice(0,80),kind:['问题','批注','修改任务'].includes(data.kind)?data.kind:'问题',status:'待回应',author:'受邀'+(room.invites.find(i=>i.id===room.members.find(m=>m.user===user)?.inviteId)?.perspective||'教师'),createdAt:new Date().toISOString(),events:[],replies:[]})}
 else if(m[2]==='reply'){if(role!=='owner')throw new RoomError('只有项目所有者可以提交学生回应。',403);const c=room.comments.find(c=>c.id===data.commentId);if(!c)throw new RoomError('问题不存在。',404);if(c.replies.length>=30)throw new RoomError('此问题的回应已达到上限。');if((c.events||[]).length>=80)throw new RoomError('此问题的讨论已达到上限，请另建下一轮评审。');const files=[];
 if(data.files?.length){
   if(room.kind!=='final'||!Array.isArray(data.files)||data.files.length>3)throw new RoomError('最多补交三份终评材料。');
   for(const item of data.files){if(!valid(item?.id))throw new RoomError('材料编号无效。');const obj=await b.head(prefix+'files/'+item.id);if(obj?.customMetadata?.purpose!=='final')throw new RoomError('无权分享此材料。',403);files.push({id:item.id,name:decodeURIComponent(obj.customMetadata.name),type:obj.customMetadata.type})}
 }
 c.replies.push({text:required(data.text,4000),createdAt:new Date().toISOString(),...(files.length?{files}:{})});c.status='待复核';c.events=[...(c.events||[]),{role:'项目所有者',status:'待复核',at:new Date().toISOString()}]}
 else if(m[2]==='resolve'){if(role!=='reviewer')throw new RoomError('只有受邀评审者可以复核。',403);const c=room.comments.find(c=>c.id===data.commentId);if(!c||!['继续修改','已完成'].includes(data.status))throw new RoomError('问题或处理状态无效。');if((c.events||[]).length>=80)throw new RoomError('此问题的讨论已达到上限，请另建下一轮评审。');c.status=data.status;c.events=[...(c.events||[]),{role:'受邀'+(room.invites.find(i=>i.id===room.members.find(m=>m.user===user)?.inviteId)?.perspective||'教师'),status:data.status,at:new Date().toISOString()}]}
 else throw new RoomError('评审接口不存在。',404);
 const saved=await write(b,roomKey(room.id),old,room);return json({room:present(room,role),etag:saved.etag});
}catch(e){return json({error:e instanceof RoomError?e.message:'评审操作暂时未完成，请稍后重试。'},e instanceof RoomError?e.status:500)}}
