import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../worker/api.js';

class Bucket {
  data=new Map();
  serial=0;
  async get(key) {
    const object=this.data.get(key);
    return object?{...object,json:async()=>JSON.parse(object.value),body:new Blob([object.value]).stream()}:null;
  }
  async head(key) {return this.data.get(key)}
  async put(key,value,options={}) {
    const old=this.data.get(key);
    if(options.onlyIf?.etagMatches && options.onlyIf.etagMatches!==old?.etag)return null;
    if(options.onlyIf?.etagDoesNotMatch==='*' && old)return null;
    const object={value,etag:'e'+(++this.serial),...options};
    this.data.set(key,object);
    return {etag:object.etag};
  }
}

test('Standalone submissions enforce ownership, retry safety, teacher conclusions and supplementary file authorization',async()=>{
  const bucket=new Bucket();
  const env={BUCKET:bucket};
  async function call(user,path,method='GET',body,etag) {
    return api(new Request('https://studio.test'+path,{method,headers:{
      'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',
      ...(etag?{'If-Match':etag}:{})
    },body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  }
  async function good(...args) {
    const response=await call(...args);
    const result=await response.json();
    assert.ok(response.ok,JSON.stringify(result));
    return result;
  }
  const upload=await good('student','/api/final-files?name=board.pdf','POST',new TextEncoder().encode('%PDF-1.4 actual original'));
  assert.equal(bucket.data.has('users/student/state.json'),false);
  assert.equal((await call('student','/api/final-files?name=fake.png','POST',new TextEncoder().encode('bad'))).status,400);
  const submission={kind:'final',requestId:'repeat-safe',title:'阅览亭',files:[{id:upload.file.id,extractedText:'阅览亭以庭院组织公共空间。'}]};
  const first=await good('student','/api/review-rooms','POST',submission);
  const id=first.room.id,path='/api/review-rooms/'+id;
  assert.equal((await good('student','/api/review-rooms','POST',submission)).room.id,id);
  assert.equal((await good('student','/api/review-rooms')).rooms.length,1);
  assert.equal((await call('other','/api/review-rooms','POST',submission)).status,409);
  assert.equal((await call('other',path)).status,403);
  assert.equal((await call('other',path+'/files/'+upload.file.id)).status,403);
  assert.equal((await call('student',path+'/verdict','POST',{decision:'已评阅',text:'forged'},first.etag)).status,403);
  assert.equal((await call('other','/api/review-rooms','POST',{...submission,requestId:'other-submission'})).status,400);
  const invitation=await good('student',path+'/invites','POST',{role:'reviewer',perspective:'教师',email:'teacher@example.test',days:7},first.etag);
  await good('teacher','/api/review-rooms/accept','POST',{token:invitation.inviteUrl.split('/invite/')[1]});
  let current=await good('teacher',path);
  const verdict=await good('teacher',path+'/verdict','POST',{decision:'需补充',text:'请补入口剖面。'},current.etag);
  assert.equal(verdict.room.comments.length,1);
  assert.equal((await call('teacher',path+'/verdict','POST',{decision:'已评阅',text:'stale'},current.etag)).status,409);
  const commentId=verdict.room.comments[0].id;
  const supplement=(await good('student','/api/final-files?name=section.pdf','POST',new TextEncoder().encode('%PDF-1.4 section'))).file;
  const foreign=(await good('other','/api/final-files?name=private.pdf','POST',new TextEncoder().encode('%PDF-1.4 private'))).file;
  current=await good('student',path);
  assert.equal((await call('student',path+'/reply','POST',{commentId,text:'bad',files:[{id:foreign.id}]},current.etag)).status,403);
  await good('student',path+'/reply','POST',{commentId,text:'已补交。',files:[{id:supplement.id}]},current.etag);
  assert.equal((await call('teacher',path+'/files/'+supplement.id)).status,200);
  assert.equal((await call('teacher',path+'/files/'+foreign.id)).status,404);
  const stored=await good('teacher',path);
  assert.equal(stored.room.comments[0].status,'待复核');
  assert.equal(stored.room.version.snapshot.files.length,1);
  assert.equal(stored.room.ownerPrefix,undefined);
  current=await good('student',path);
  await good('student',path+'/revoke','POST',{inviteId:invitation.room.invites[0].id},current.etag);
  assert.equal((await call('teacher',path+'/files/'+supplement.id)).status,403);
  assert.equal((await call('teacher',path)).status,403);
});

test('Final AI reviews use submitted evidence, are billed once per request, and expose no private project state',async()=>{
  const bucket=new Bucket(),originalFetch=globalThis.fetch;
  const env={BUCKET:bucket,AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'test-final-key',AI_ALLOWED_EMAILS:'student@example.test'};
  let calls=0;
  const call=(user,path,method='GET',body,tag)=>api(new Request('https://studio.test'+path,{method,headers:{
    'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',...(tag?{'If-Match':tag}:{})
  },body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  const good=async(...args)=>{
    const response=await call(...args),result=await response.json();
    assert.ok(response.ok,JSON.stringify(result));return result;
  };
  try{
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://api.deepseek.com/chat/completions');calls++;
      const context=JSON.parse(JSON.parse(options.body).messages[1].content);
      assert.equal(context.sources.find(s=>s.id.startsWith('extracted-')).text,'提交展板以庭院组织公共空间。');
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'请补入口图。',comments:[{
        title:'入口关系需要依据',dimension:'论据支撑',priority:0,sourceId:'brief',quote:'阅览亭',kind:'依据不足',
        evidence:'提交件说明了庭院关系。',need:'入口图。',suggestion:'补图。',question:'如何到达？'
      }]})}}],usage:{prompt_tokens:10,completion_tokens:10}});
    };
    const file=(await good('student','/api/final-files?name=board.pdf','POST',new TextEncoder().encode('%PDF-1.4 real'))).file;
    const room=await good('student','/api/review-rooms','POST',{kind:'final',title:'阅览亭',files:[{id:file.id,extractedText:'提交展板以庭院组织公共空间。'}]});
    const data={kind:'review',projectId:'final-'+room.room.id,finalRoomId:room.room.id,requestId:'final-ai'};
    assert.equal((await call('student','/api/ai/generate','POST',data,'stale')).status,409);
    const run=(await good('student','/api/ai/generate','POST',data,room.etag)).run;
    assert.equal(run.status,'succeeded');
    await good('student','/api/ai/generate','POST',data,room.etag);
    assert.equal(calls,1);
    const result=(await good('student','/api/review-rooms/'+room.room.id)).room;
    assert.equal(result.aiReview.comments.length,1);
    assert.equal(result.aiReview.sources,undefined);
    assert.equal(result.verdict,undefined);
    assert.equal(bucket.data.has('users/student/state.json'),false);
    assert.equal((await call('student','/api/ai/runs/final-ai/apply','POST',{})).status,400);
    assert.equal((await call('other','/api/ai/runs/final-ai')).status,404);
  }finally{globalThis.fetch=originalFetch}
});
