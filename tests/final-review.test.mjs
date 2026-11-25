import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../worker/api.js';
import {finalArchiveHtml} from '../src/final-archive.js';

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

test('SKP final reviews capture server conversion, authorize shared models and freeze a recovered result',async()=>{
  const bucket=new Bucket(),env={BUCKET:bucket};
  async function request(user,path,method='GET',body,etag){
    return api(new Request('https://studio.test'+path,{method,headers:{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',...(etag?{'If-Match':etag}:{})},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  }
  async function good(...args){const r=await request(...args),data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data}
  const file=(await good('student','/api/final-files?name=work.skp','POST',new TextEncoder().encode('real upload kept'))).file;
  assert.equal(file.type,'skp');
  const model=await good('student','/api/models/'+file.id);
  assert.equal(model.model.status,'uploaded');
  const submitted=await good('student','/api/review-rooms','POST',{kind:'final',title:'模型',files:[{id:file.id,conversion:{status:'ready',resultId:'forged'}}]});
  const path='/api/review-rooms/'+submitted.room.id;
  assert.equal(submitted.room.version.snapshot.files[0].conversion.status,'uploaded');
  assert.equal((await request('other',path+'/refresh-model','POST',{fileId:file.id},submitted.etag)).status,403);
  const start=(await good('student','/api/models/'+file.id+'/retry','POST')).model;
  const failed={...start,status:'failed',error:'测试转换失败'};
  await bucket.put('users/student/models/'+file.id+'/status.json',JSON.stringify(failed));
  const recorded=await good('student',path+'/refresh-model','POST',{fileId:file.id},submitted.etag);
  assert.equal(recorded.room.version.snapshot.files[0].conversion.status,'failed');
  const retry=(await good('student','/api/models/'+file.id+'/retry','POST')).model;
  assert.equal(retry.status,'queued');assert.notEqual(retry.jobId,start.jobId);
  const recovered={fileId:file.id,status:'ready',resultId:'converted-one'};
  await bucket.put('users/student/models/'+file.id+'/status.json',JSON.stringify(recovered));
  await bucket.put('users/student/models/'+file.id+'/results/converted-one.glb',new Uint8Array([1,2,3]));
  const refreshed=await good('student',path+'/refresh-model','POST',{fileId:file.id},recorded.etag);
  assert.equal(refreshed.room.version.snapshot.files[0].conversion.resultId,'converted-one');
  await bucket.put('users/student/models/'+file.id+'/status.json',JSON.stringify({...recovered,resultId:'converted-two'}));
  const again=await good('student',path+'/refresh-model','POST',{fileId:file.id},refreshed.etag);
  assert.equal(again.room.version.snapshot.files[0].conversion.resultId,'converted-one');
  const invite=await good('student',path+'/invites','POST',{role:'reviewer',perspective:'教师',email:'teacher@example.test',days:7},again.etag);
  await good('teacher','/api/review-rooms/accept','POST',{token:invite.inviteUrl.split('/invite/')[1]});
  assert.equal((await request('teacher',path+'/models/'+file.id)).status,200);
  assert.equal((await request('other',path+'/models/'+file.id)).status,403);
  assert.equal(bucket.data.has('users/student/state.json'),false);
});

test('A final revision has its own files, teacher reviews and AI result even if the previous review completes later',async()=>{
  const bucket=new Bucket(),originalFetch=globalThis.fetch;
  const env={BUCKET:bucket,AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'test-final-key',AI_ALLOWED_EMAILS:'student@example.test'};
  const call=(user,path,method='GET',body,etag)=>api(new Request('https://studio.test'+path,{method,headers:{
    'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',
    'oai-authenticated-user-name':encodeURIComponent(user),...(etag?{'If-Match':etag}:{})
  },body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  const good=async(...args)=>{
    const response=await call(...args),result=await response.json();
    assert.ok(response.ok,JSON.stringify(result));return result;
  };
  const pdf=message=>new TextEncoder().encode('%PDF-1.4 '+message);
  const makeDoc=async(text)=>{
    const file=(await good('student','/api/final-files?name=board.pdf','POST',pdf(text))).file;
    return {id:file.id,pdfPageCount:14,pdfPages:[{page:2,text}],pdfTruncated:true};
  };
  let releaseAi;
  let calls=0,enteredAi;
  const started=new Promise(resolve=>{enteredAi=resolve});
  const contexts=[];
  globalThis.fetch=async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    contexts.push(input);calls++;
    if(calls===1)await new Promise(resolve=>{releaseAi=resolve;enteredAi()});
    const source=input.sources.find(row=>row.page===2);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:source.text,comments:[{
      title:'入口依据',dimension:'论据支撑',priority:0,sourceId:source.id,quote:source.text,kind:'依据不足',
      evidence:source.text,need:'请补剖面',suggestion:'标出入口',question:'从哪里进入？'
    }]})}}]});
  };
  let pendingAi;
  try{
    const firstPdf=await makeDoc('原稿的入口说明'),secondPdf=await makeDoc('改稿的通行说明');
    const first=await good('student','/api/review-rooms','POST',{kind:'final',title:'独立终评作品',files:[firstPdf]});
    const original=first.room.version.id,roomId=first.room.id,path='/api/review-rooms/'+roomId;
    const unauthorized=(await good('other','/api/final-files?name=private.pdf','POST',pdf('other project'))).file;
    const cover=(await good('student','/api/final-files?name=wrong.jpg&parentId='+firstPdf.id+'&page=1','POST',Uint8Array.of(255,216,255,217))).file;
    let etag=first.etag,firstInvite;
    for(const user of ['teacher-a','teacher-b']){
      const invitation=await good('student',path+'/invites','POST',{role:'reviewer',perspective:'教师',email:user+'@example.test',days:7},etag);
      firstInvite??=invitation.room.invites[0].id;
      await good(user,'/api/review-rooms/accept','POST',{token:invitation.inviteUrl.split('/invite/')[1]});
      etag=(await good('student',path)).etag;
    }
    const opinion=(await good('teacher-a',path+'/comments','POST',{versionId:original,source:firstPdf.id,text:'原稿图纸第二页',imagePoint:{x:.6,y:.3,page:2}},etag));
    const gradeA={versionId:original,decision:'需修改',text:'V1 教师要求调整',requestId:'v1-grade-a'};
    const gradeB={versionId:original,decision:'已评阅',text:'V1 另一位教师意见',requestId:'v1-grade-b'};
    const grading=await Promise.all([call('teacher-a',path+'/verdict','POST',gradeA,opinion.etag),call('teacher-b',path+'/verdict','POST',gradeB,opinion.etag)]);
    assert.deepEqual(grading.map(r=>r.status).sort(),[200,409]);
    const fresh=await good('student',path);
    await good(grading[0].ok?'teacher-b':'teacher-a',path+'/verdict','POST',grading[0].ok?gradeB:gradeA,fresh.etag);
    const before=await good('student',path);
    assert.equal(before.room.verdicts.length,2);assert.ok(before.room.verdicts.every(row=>!row.authorId));
    const aiData={kind:'review',projectId:'final-'+roomId,finalRoomId:roomId,submissionVersionId:original,requestId:'old-running-review'};
    pendingAi=good('student','/api/ai/generate','POST',aiData,before.etag);
    await Promise.race([started,pendingAi.then(()=>assert.fail('Provider did not remain in progress'))]);
    const revision={parentVersionId:original,note:'入口重新布置',files:[secondPdf],requestId:'share-v2'};
    assert.equal((await call('teacher-a',path+'/versions','POST',revision,before.etag)).status,403);
    assert.equal((await call('student',path+'/versions','POST',{...revision,files:[unauthorized]},before.etag)).status,400);
    assert.equal((await call('student',path+'/versions','POST',{...revision,files:[{...secondPdf,previewId:cover.id}]},before.etag)).status,400);
    const revised=await good('student',path+'/versions','POST',revision,before.etag),v2=revised.room.version.id;
    assert.deepEqual(revised.room.versions.map(v=>v.id),[original,v2]);
    assert.equal(revised.room.version.parentVersionId,original);
    assert.equal((await good('student',path+'/versions','POST',revision,before.etag)).room.version.id,v2);
    assert.equal((await call('student',path+'/versions','POST',{...revision,note:'changed payload'},revised.etag)).status,409);
    assert.equal((await call('student',path+'/versions','POST',{...revision,requestId:'new-stale-id'},revised.etag)).status,409);
    assert.equal((await call('teacher-a',path+'/versions/'+v2+'/files/'+firstPdf.id)).status,404);
    assert.equal((await call('teacher-a',path+'/files/'+secondPdf.id)).status,404);
    assert.equal((await call('teacher-a',path+'/versions/'+v2+'/files/'+secondPdf.id)).status,200);
    assert.equal((await call('teacher-a',path+'/comments','POST',{versionId:v2,source:firstPdf.id,text:'wrong version'},revised.etag)).status,400);
    assert.equal((await call('student',path+'/reply','POST',{versionId:v2,text:'wrong version',commentId:opinion.room.comments[0].id},revised.etag)).status,404);
    releaseAi();
    assert.equal((await pendingAi).run.submissionVersionId,original);
    const current=(await good('teacher-a',path+'?version=latest')).room;
    assert.equal(current.version.id,v2);assert.equal(current.aiReview,null);assert.deepEqual(current.verdicts,[]);assert.deepEqual(current.comments,[]);
    const saved=(await good('teacher-a',path+'?version='+original)).room;
    assert.equal(saved.aiReview.summary,'原稿的入口说明');assert.equal(saved.aiReview.comments[0].page,2);
    assert.deepEqual(saved.aiReview.coverage[0].textPages,[2]);assert.equal(saved.aiReview.coverage[0].pdfTruncated,true);
    assert.equal((await call('student','/api/ai/generate','POST',{...aiData,submissionVersionId:v2},revised.etag)).status,409);
    await good('student','/api/ai/generate','POST',{...aiData,submissionVersionId:v2,requestId:'new-version-ai'},revised.etag);
    assert.deepEqual(contexts.map(data=>[data.submissionVersionId,data.sources.find(row=>row.page===2).fileId]),[[original,firstPdf.id],[v2,secondPdf.id]]);
    assert.equal((await good('teacher-a','/api/review-rooms')).rooms[0].versionNumber,2);
    const latest=(await good('teacher-a',path+'?version=latest')).room;
    assert.equal(latest.aiReview.summary,'改稿的通行说明');
    assert.match(finalArchiveHtml(saved),/V1 教师要求调整/);assert.doesNotMatch(finalArchiveHtml(latest),/原稿的入口说明|V1 教师要求调整/);
    assert.match(finalArchiveHtml(latest),/改稿的通行说明/);
    await good('student',path+'/revoke','POST',{versionId:v2,inviteId:firstInvite},revised.etag);
    assert.equal((await call('teacher-a',path+'/versions/'+original+'/files/'+firstPdf.id)).status,403);
    assert.equal((await call('teacher-a',path+'?version='+v2)).status,403);
  }finally{releaseAi?.();await pendingAi?.catch(()=>{});globalThis.fetch=originalFetch}
});

test('Visual final AI evidence uses the frozen SKP conversion and restores only the actual view sent',async()=>{
  const bucket=new Bucket(),originalFetch=globalThis.fetch;
  const env={BUCKET:bucket,AI_PROVIDER:'openai',OPENAI_API_KEY:'test-final-key',AI_ALLOWED_EMAILS:'student@example.test'};
  const call=(path,method='GET',body,etag,user='student')=>api(new Request('https://studio.test'+path,{method,headers:{
    'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',...(etag?{'If-Match':etag}:{})
  },body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  const good=async(...args)=>{const response=await call(...args);const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body};
  const bytes=Uint8Array.of(255,216,255,217),dataUrl='data:image/jpeg;base64,'+btoa(String.fromCharCode(...bytes));
  const camera={position:[1,2,3],target:[0,0,0]};
  let requests=0,useUnknownSource=false;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');requests++;
    const parts=JSON.parse(options.body).input[0].content,context=JSON.parse(parts[0].text);
    assert.ok(parts.some(part=>part.type==='input_image'&&part.image_url===dataUrl));
    const model=context.sources.find(row=>row.id.startsWith('model-'));
    assert.equal(model.resultId,'frozen-model');
    const sourceId=useUnknownSource?'not-sent':'view-1';
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
      summary:'已阅读所选视角。',comments:[{title:'模型视角',dimension:'论据支撑',priority:0,sourceId,quote:'',kind:'可直接观察',
        evidence:'已收到轴测视图',need:'补正视图',suggestion:'补材料',question:'正视图的边界在哪里？'}]
    })}]}]});
  };
  try{
    const file=(await good('/api/final-files?name=study.skp','POST',new Uint8Array([5,4,3]))).file;
    const captured={fileId:file.id,status:'ready',resultId:'frozen-model'};
    await bucket.put('users/student/models/'+file.id+'/status.json',JSON.stringify(captured));
    const first=await good('/api/review-rooms','POST',{kind:'final',title:'体块研究',files:[file]});
    const finalRoomId=first.room.id,submissionVersionId=first.room.version.id,path='/api/review-rooms/'+finalRoomId;
    await bucket.put('users/student/models/'+file.id+'/status.json',JSON.stringify({...captured,resultId:'changed-model'}));
    const view={fileId:file.id,label:'轴测',resultId:'frozen-model',camera,dataUrl};
    const data={kind:'review',projectId:'final-'+finalRoomId,finalRoomId,submissionVersionId,requestId:'first-visual',views:[view]};
    assert.equal((await call('/api/ai/generate','POST',{...data,views:[{...view,resultId:'changed-model'}]},first.etag)).status,409);
    assert.equal((await call('/api/ai/generate','POST',{...data,views:[{...view,camera:null}]},first.etag)).status,400);
    assert.equal(requests,0);
    await good('/api/ai/generate','POST',data,first.etag);
    const result=(await good(path)).room.aiReview;
    assert.equal(result.comments[0].modelViewId,'view-1');assert.deepEqual(result.comments[0].camera,camera);
    assert.deepEqual(result.coverage[0].modelViews,[{id:'view-1',label:'轴测'}]);
    const pathToImage=path+'/versions/'+submissionVersionId+'/ai-views/'+result.id+'/view-1';
    const response=await call(pathToImage);
    assert.equal(response.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    assert.equal((await call(pathToImage,'GET',undefined,undefined,'stranger')).status,403);
    useUnknownSource=true;
    assert.equal((await call('/api/ai/generate','POST',{...data,requestId:'unknown-evidence'},first.etag)).status,502);
    assert.equal((await good(path)).room.aiReview.id,result.id);
    const syntheticLarge=new Request('https://studio.test/api/final-files?name=huge.pdf',{method:'POST',headers:{
      'oai-authenticated-user-id':'student','oai-authenticated-user-email':'student@example.test','Content-Length':String(20*1024*1024+1)
    },body:new TextEncoder().encode('%PDF-1.4 oversize test')});
    assert.equal((await api(syntheticLarge,env)).status,413);
  }finally{globalThis.fetch=originalFetch}
});
