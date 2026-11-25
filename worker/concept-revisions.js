export class RoomError extends Error {
  constructor(message,status=400){super(message);this.status=status}
}

export const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(s);
const revisionKey=(room,versionId)=>'review-rooms/'+room.id+'/versions/'+versionId+'.json';
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const coordinate=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(n=>finite(n,-10000,10000));

export function versionSummaries(room){
  const {id,number,label,createdAt}=room.version;
  return [{id,number,label,createdAt,sharedAt:room.createdAt},...(room.sharedVersions||[])];
}

export async function sharedRevision(bucket,room,versionId){
  if(!valid(versionId))throw new RoomError('共享版本不存在。',404);
  if(room.version.id===versionId)return room.version;
  if(!room.sharedVersions?.some(version=>version.id===versionId))throw new RoomError('共享版本不存在。',404);
  const object=await bucket.get(revisionKey(room,versionId));
  if(!object)throw new RoomError('共享版本暂不可用，请稍后重试。',503);
  return object.json();
}

export async function storeSharedRevision(bucket,room,version){
  // An object is only readable after the room's conditional index write succeeds.
  const key=revisionKey(room,version.id);
  const stored=await bucket.put(key,JSON.stringify(version),{
    onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}
  });
  const immutable=stored?version:await (await bucket.get(key))?.json();
  if(!immutable)throw new RoomError('无法登记共享版本，请重试。',503);
  const {id,number,label,createdAt,parentVersionId}=immutable;
  room.sharedVersions=[...(room.sharedVersions||[]),{id,number,label,createdAt,
    sharedAt:new Date().toISOString(),...(parentVersionId?{parentVersionId}:{})}];
}

export async function addRevision(bucket,room,versionId){
  if(!valid(versionId))throw new RoomError('请选择有效的项目版本。');
  if(versionSummaries(room).some(version=>version.id===versionId))return false;
  if((room.sharedVersions||[]).length>=30)throw new RoomError('此讨论已共享 30 个后续版本，请另建下一轮讨论。');
  const object=await bucket.get(room.ownerPrefix+'state.json');
  const state=object&&await object.json();
  const version=state?.projects.find(project=>project.id===room.projectId)?.versions.find(row=>row.id===versionId);
  if(!version)throw new RoomError('所选版本不属于此项目。',404);
  const payload=structuredClone(version);
  delete payload.snapshot.aiAssistantReceipts;
  await storeSharedRevision(bucket,room,payload);
  return true;
}

export function conceptAnchor(version,anchor){
  if(!anchor)return null;
  const invalid=()=>{throw new RoomError('批注位置或视角不属于此共享版本。')};
  if(anchor.versionId!==version.id)invalid();
  if(anchor.kind==='general')return {kind:'general',versionId:version.id};
  const option=version.snapshot.workflow?.options.find(row=>row.id===anchor.optionId);
  if(!option?.plan||anchor.spaceId&&!option.plan.spaces.some(space=>space.id===anchor.spaceId))invalid();
  const viewBox=anchor.view?.viewBox;
  if(!coordinate(viewBox,4)||viewBox[2]<.1||viewBox[3]<.1)invalid();
  const base={versionId:version.id,optionId:option.id,...(anchor.spaceId?{spaceId:anchor.spaceId}:{})};
  if(anchor.kind==='plan'&&coordinate(anchor.xy,2)){
    return {...base,kind:'plan',xy:anchor.xy,view:{viewBox}};
  }
  const camera=anchor.view?.camera;
  if(anchor.kind==='mass'&&coordinate(anchor.xyz,3)&&finite(anchor.xyz[2],0,30)&&
    finite(camera?.yaw,-Math.PI,Math.PI)&&finite(camera?.pitch,.12,1.4)){
    return {...base,kind:'mass',xyz:anchor.xyz,view:{viewBox,camera:{yaw:camera.yaw,pitch:camera.pitch}}};
  }
  invalid();
}

export function conceptTasks(room,role,user){
  if(room.kind==='final')return [];
  const tasks=[];
  if(role==='reviewer'&&!room.comments.some(comment=>comment.authorId===user)){
    tasks.push({id:'review-'+room.version.id,kind:'待点评'});
  }
  for(const comment of room.comments){
    const event=comment.events?.at(-1)?.id||comment.id;
    if(role==='owner'&&['待回应','继续修改'].includes(comment.status)){
      tasks.push({id:event,kind:comment.status,commentId:comment.id});
    }
    if(role==='reviewer'&&comment.status==='待复核'&&(!comment.authorId||comment.authorId===user)){
      tasks.push({id:event,kind:'待复核',commentId:comment.id});
    }
  }
  return tasks;
}

const readKey=(prefix,room)=>prefix+'review-reads/'+room.id+'.json';
export async function taskSummary(bucket,prefix,room,role,user){
  const tasks=conceptTasks(room,role,user);
  if(!tasks.length)return {counts:{},unread:0};
  const object=await bucket.get(readKey(prefix,room));
  const read=new Set(object?await object.json():[]);
  const counts={};
  for(const task of tasks)counts[task.kind]=(counts[task.kind]||0)+1;
  return {counts,unread:tasks.filter(task=>!read.has(task.id)).length};
}

export async function markTasksRead(bucket,prefix,room,role,user,eventIds){
  const visible=new Set(conceptTasks(room,role,user).map(task=>task.id));
  if(!Array.isArray(eventIds)||eventIds.length>151||eventIds.some(id=>!visible.has(id))){
    throw new RoomError('待办已更新，请刷新后再查看。',409);
  }
  const key=readKey(prefix,room);
  for(let attempt=0;attempt<5;attempt++){
    const old=await bucket.get(key);
    const ids=new Set(old?await old.json():[]);
    const next=[...new Set([...ids,...eventIds])].slice(-500);
    if(await bucket.put(key,JSON.stringify(next),{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},
      httpMetadata:{contentType:'application/json'}}))return;
  }
  throw new RoomError('读取状态暂未保存，请重试。',409);
}
