const ID=/^[a-zA-Z0-9-]{1,80}$/;
const CODE=/^[a-f0-9]{40}$/;
const message=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});
const codeIndex=prefix=>prefix+'mentor-code.json';
const contactIndex=prefix=>prefix+'mentors.json';

class MentorError extends Error{
  constructor(text,status=400){super(text);this.status=status}
}

async function read(bucket,key){
  const result=await bucket.get(key);
  return result?{value:await result.json(),etag:result.etag}:null;
}

function put(bucket,key,value,old){
  return bucket.put(key,JSON.stringify(value),{
    onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}
  });
}

async function codeHash(value){
  const bytes=new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
}

const publicContacts=rows=>rows.map(({id,name})=>({id,name}));
const contacts=async(bucket,prefix)=>(await read(bucket,contactIndex(prefix)))?.value||[];

export async function findMentor(bucket,prefix,id){
  return typeof id==='string'&&ID.test(id)?(await contacts(bucket,prefix)).find(row=>row.id===id):null;
}

async function editContacts(bucket,prefix,edit){
  const key=contactIndex(prefix);
  for(let attempt=0;attempt<5;attempt++){
    const previous=await read(bucket,key),next=edit(previous?.value||[]);
    if(await put(bucket,key,next,previous))return publicContacts(next);
  }
  throw new MentorError('导师名单已更新，请重试。',409);
}

async function issueCode(request,bucket,prefix,user){
  if(!request.headers.get('oai-authenticated-user-email')){
    throw new MentorError('确认账号身份后即可生成导师连接码。',403);
  }
  const code=Array.from(crypto.getRandomValues(new Uint8Array(20)),v=>v.toString(16).padStart(2,'0')).join('');
  const hash=await codeHash(code),key=codeIndex(prefix),old=await read(bucket,key);
  const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
  let name='导师';
  try{name=decodeURIComponent(request.headers.get('oai-authenticated-user-name')||'').trim().slice(0,80)||name}catch{}
  const ticket='mentor-codes/'+hash+'.json';
  if(!await put(bucket,ticket,{user,name,expiresAt},null))throw new MentorError('连接码未生成，请重试。',409);
  if(!await put(bucket,key,{hash,expiresAt},old))throw new MentorError('连接码已在其他页面更新，请重试。',409);
  if(old?.value.hash)await bucket.delete?.('mentor-codes/'+old.value.hash+'.json').catch(()=>{});
  return {code,expiresAt};
}

async function connectMentor(bucket,prefix,user,value){
  const code=typeof value==='string'?value.trim().toLowerCase():'';
  if(!CODE.test(code))throw new MentorError('请输入老师分享的完整连接码。');
  const hash=await codeHash(code),row=(await read(bucket,'mentor-codes/'+hash+'.json'))?.value;
  if(!row||Date.parse(row.expiresAt)<=Date.now())throw new MentorError('连接码无效或已过期，请向老师索取新的连接码。',404);
  const active=(await read(bucket,codeIndex('users/'+encodeURIComponent(row.user)+'/')))?.value;
  if(active?.hash!==hash)throw new MentorError('连接码已经更换，请向老师索取新码。',404);
  if(row.user===user)throw new MentorError('不能把自己加入导师名单。');
  return editContacts(bucket,prefix,previous=>{
    const existing=previous.find(contact=>contact.user===row.user);
    if(existing)return previous.map(contact=>contact===existing?{...existing,name:row.name}:contact);
    if(previous.length>=50)throw new MentorError('导师名单已有 50 人，请先移除不使用的联系人。');
    return [...previous,{id:crypto.randomUUID(),user:row.user,name:row.name}];
  });
}

export async function mentorsApi(request,bucket,prefix,user,readJson){
  const path=new URL(request.url).pathname,method=request.method;
  if(path!=='/api/mentors'&&!path.startsWith('/api/mentors/'))return null;
  try{
    if(path==='/api/mentors'&&method==='GET')return message({mentors:publicContacts(await contacts(bucket,prefix))});
    if(path==='/api/mentors/code'&&method==='POST')return message(await issueCode(request,bucket,prefix,user),201);
    if(path==='/api/mentors/connect'&&method==='POST'){
      const data=await readJson(request,1000);
      return message({mentors:await connectMentor(bucket,prefix,user,data.code)});
    }
    const match=path.match(/^\/api\/mentors\/([a-zA-Z0-9-]{1,80})$/);
    if(match&&method==='DELETE')return message({mentors:await editContacts(bucket,prefix,rows=>rows.filter(row=>row.id!==match[1]))});
    return message({error:'导师操作未找到。'},404);
  }catch(error){
    if(error instanceof MentorError)return message({error:error.message},error.status);
    if(error instanceof SyntaxError)return message({error:'请求格式无效。'},400);
    throw error;
  }
}
