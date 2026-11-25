import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,appendFile,stat} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {createStudioServer} from '../server/index.mjs';
import {createBackup,verifyBackup,restoreBackup,compareWithBackup} from '../server/recovery.mjs';
import {verifyRelease} from '../server/release-check.mjs';
import {createSeed} from '../src/data.js';
import {encryptConnection} from '../worker/ai-secrets.js';

const origin='http://127.0.0.1',revision='b'.repeat(40),password='recovery-password-123';
const operationsEnv={RAILWAY_ENVIRONMENT_ID:'',AI_SECRET_ENCRYPTION_KEY:'',BOOTSTRAP_TOKEN:'',DEEPSEEK_API_KEY:'',
  OPENAI_API_KEY:'',AI_ALLOWED_EMAILS:'',STUDIO_RELEASE_REVISION:revision,STUDIO_PILOT_TELEMETRY:'0',STUDIO_READ_ONLY:'0'};
const pdf=text=>new TextEncoder().encode('%PDF-1.4 '+text);

async function workspace(t){
  const folder=await mkdtemp(join(tmpdir(),'studio-release-'));
  t.after(async()=>{
    assert.match(relative(tmpdir(),folder),/^studio-release-[^\\/]+$/);
    await rm(folder,{recursive:true,force:true});
  });
  return folder;
}

function client(app){
  const call=(path,method='GET',body,headers={})=>app.handle(new Request(origin+path,{method,
    headers:{Origin:origin,...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}));
  const good=async(...args)=>{const response=await call(...args),value=await response.json();assert.ok(response.ok,JSON.stringify(value));return {response,value}};
  return {call,good};
}

async function setup(app,directory){
  const {good}=client(app),token=(await readFile(join(directory,'bootstrap-token'),'utf8')).trim();
  const {response,value}=await good('/api/auth/setup','POST',{email:'owner@example.test',name:'试点学生',password,token});
  return {user:value.user,headers:{cookie:response.headers.get('set-cookie').split(';')[0]}};
}

test('SQLite online backup and isolated restore preserve projects, both review versions, media and encrypted settings',async t=>{
  const folder=await workspace(t),live=join(folder,'live'),backup=join(folder,'snapshot'),restored=join(folder,'restored');
  const app=await createStudioServer({dataDir:live,origin,env:operationsEnv});
  let copy;
  try{
    const {headers}=await setup(app,live),{good,call}=client(app);
    const original=createSeed();
    const initial=(await good('/api/state','PUT',original,{...headers,'If-None-Match':'*'})).value;
    const legacy=(await good('/api/snapshots','POST',{projectId:'demo-reading',kind:'stage',label:'旧版图稿',note:'保存时点'},
      {...headers,'If-Match':initial.etag})).value;
    const oldRoom=(await good('/api/review-rooms','POST',{projectId:'demo-reading',versionId:legacy.versionId,title:'旧版概念讨论'},headers)).value;
    const modelBytes=Uint8Array.of(5,8,13),glb=Uint8Array.of(21,34,55);
    const model=(await good('/api/final-files?name=mass.skp','POST',modelBytes,headers)).value.file;
    const sheet=(await good('/api/final-files?name=plan.pdf','POST',pdf('version one'),headers)).value.file;
    const later=(await good('/api/final-files?name=plan.pdf','POST',pdf('version two'),headers)).value.file;
    const user=(await good('/api/auth/me','GET',undefined,headers)).value.user;
    const prefix='users/'+user.id+'/';
    await app.bucket.put(prefix+'models/'+model.id+'/status.json',JSON.stringify({fileId:model.id,status:'ready',resultId:'fixture-result'}));
    await app.bucket.put(prefix+'models/'+model.id+'/results/fixture-result.glb',glb);
    const final=(await good('/api/review-rooms','POST',{kind:'final',title:'独立终评',files:[model,sheet]},headers)).value;
    const path='/api/review-rooms/'+final.room.id;
    const newest=(await good(path+'/versions','POST',{parentVersionId:final.room.version.id,requestId:'new-submission',note:'补充图纸',files:[model,later]},
      {...headers,'If-Match':final.etag})).value;
    const aiKey=(await readFile(join(live,'ai-encryption.key'),'utf8')).trim();
    const encrypted=await encryptConnection({AI_SECRET_ENCRYPTION_KEY:aiKey},'site-ai/','test-restored-site-key');
    await app.bucket.put('site-ai/ai/connection.json',JSON.stringify({...encrypted,enabled:true,model:'deepseek-chat',userDailyLimit:3,siteDailyLimit:30}));
    assert.ok((await stat(join(live,'studio.sqlite-wal'))).size>0);
    const saved=await createBackup(live,backup,operationsEnv);
    assert.equal(saved.accounts,1);assert.equal(saved.projectVersions,1);assert.equal(saved.rooms,2);assert.equal(saved.roomVersions,3);
    for(const issue of ['missingVersions','missingMaterials','invalidRecords','unreadableConnections'])assert.equal(saved[issue],0);
    assert.equal(saved.revision,revision);
    assert.equal((await compareWithBackup(backup,live,operationsEnv)).differs,false);
    await assert.rejects(()=>createBackup(live,backup,operationsEnv),{code:'EEXIST'});
    await assert.rejects(()=>restoreBackup(backup,live,operationsEnv),{code:'EEXIST'});
    await assert.rejects(()=>restoreBackup(backup,join(backup,'nested'),operationsEnv),/outside the source/);

    const work=structuredClone(legacy.state);work.projects[0].name='备份之后的新作品内容';
    await good('/api/state','PUT',work,{...headers,'If-Match':legacy.etag});
    await good('/api/final-files?name=later.pdf','POST',pdf('uploaded after backup'),headers);
    const diff=await compareWithBackup(backup,live,operationsEnv);
    assert.deepEqual(diff.changes.projectStates,{added:0,changed:1,removed:0});
    assert.deepEqual(diff.changes.materials,{added:1,changed:0,removed:0});
    assert.equal(JSON.stringify(diff).includes(prefix),false);

    assert.deepEqual(await restoreBackup(backup,restored,operationsEnv),saved);
    copy=await createStudioServer({dataDir:restored,origin,env:{...operationsEnv,STUDIO_READ_ONLY:'1'}});
    const recovered=client(copy);
    assert.equal((await recovered.good('/api/auth/me','GET',undefined,headers)).value.user.id,user.id);
    assert.equal((await recovered.good('/api/ai/status','GET',undefined,headers)).value.configured,true);
    assert.equal((await recovered.good('/api/state','GET',undefined,headers)).value.state.projects[0].name,original.projects[0].name);
    assert.equal((await recovered.good('/api/review-rooms/'+oldRoom.room.id,'GET',undefined,headers)).value.room.version.id,legacy.versionId);
    assert.equal((await recovered.good(path+'?version=latest','GET',undefined,headers)).value.room.version.id,newest.room.version.id);
    assert.equal(await(await recovered.call(path+'/files/'+sheet.id,'GET',undefined,headers)).text(),'%PDF-1.4 version one');
    const versionPath=path+'/versions/'+newest.room.version.id;
    assert.equal(await(await recovered.call(versionPath+'/files/'+later.id,'GET',undefined,headers)).text(),'%PDF-1.4 version two');
    assert.deepEqual(new Uint8Array(await(await recovered.call(versionPath+'/models/'+model.id,'GET',undefined,headers)).arrayBuffer()),glb);
    assert.equal((await recovered.call(versionPath+'/models/'+model.id)).status,401);
    assert.equal((await call('/api/state','GET',undefined,headers)).status,200);
    await appendFile(join(backup,'studio.sqlite'),'invalid trailing bytes');
    await assert.rejects(()=>verifyBackup(backup,operationsEnv),/checksum mismatch/);
  }finally{await copy?.close();await app.close()}
});

test('Environment-held credentials stay in the secret store and must match during restore',async t=>{
  const folder=await workspace(t),live=join(folder,'live'),backup=join(folder,'snapshot');
  const env={...operationsEnv,AI_SECRET_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),BOOTSTRAP_TOKEN:'test-token-'.repeat(4)};
  const app=await createStudioServer({dataDir:live,origin,env});
  try{
    await createBackup(live,backup,env);
    await assert.rejects(()=>stat(join(backup,'ai-encryption.key')),{code:'ENOENT'});
    await assert.rejects(()=>stat(join(backup,'bootstrap-token')),{code:'ENOENT'});
    await assert.rejects(()=>verifyBackup(backup,operationsEnv),/original secret store/);
    await assert.rejects(()=>verifyBackup(backup,{...env,AI_SECRET_ENCRYPTION_KEY:Buffer.alloc(32,2).toString('base64')}),/does not match/);
    assert.equal((await restoreBackup(backup,join(folder,'restored'),env)).accounts,0);
  }finally{await app.close()}
});

test('Pilot events are anonymous and an interrupted upload can retry without creating a partial material',async t=>{
  const folder=await workspace(t),logs=[];
  const app=await createStudioServer({dataDir:folder,origin,env:{...operationsEnv,STUDIO_PILOT_TELEMETRY:'1'},pilotLog:line=>logs.push(line)});
  try{
    const {headers}=await setup(app,folder),{good,call}=client(app),state=createSeed();
    const initial=(await good('/api/state','PUT',state,{...headers,'If-None-Match':'*'})).value;
    assert.equal((await call('/api/state','PUT',state,{...headers,'If-Match':'stale'})).status,409);
    assert.equal((await call('/api/ai/generate','POST',{assistantInput:'private prompt text'},headers)).status,503);
    const upload=(await good('/api/final-files?name=private-model.skp','POST',new Uint8Array([1,2,3]),headers)).value.file;
    const started=(await good('/api/models/'+upload.id+'/retry','POST',undefined,headers)).value.model;
    await good('/api/models/'+upload.id+'/progress','POST',{status:'failed',error:'private conversion message'},
      {...headers,'X-Conversion-Id':started.jobId});

    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const port=app.server.address().port;
    const before=app.db.prepare("SELECT count(*) AS n FROM objects WHERE key LIKE 'users/%/files/%'").get().n;
    await new Promise((resolve,reject)=>{
      const req=httpRequest({hostname:'127.0.0.1',port,path:'/api/final-files?name=private-retry.pdf',method:'POST',
        headers:{...headers,Origin:origin,'Content-Length':400}},()=>reject(Error('Upload unexpectedly returned before interruption.')));
      req.on('error',error=>{if(error.code==='ECONNRESET')resolve();else reject(error)});
      app.server.once('request',incoming=>incoming.once('data',()=>req.destroy()));
      req.write(pdf('unfinished bytes'));
    });
    for(let i=0;i<50&&!logs.some(line=>line.includes('upload_interrupted'));i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM objects WHERE key LIKE 'users/%/files/%'").get().n,before);
    const retried=(await good('/api/final-files?name=private-retry.pdf','POST',pdf('complete bytes'),headers)).value.file;
    assert.equal(await(await call('/api/files/'+retried.id,'GET',undefined,headers)).text(),'%PDF-1.4 complete bytes');
    assert.equal((await good('/api/state','GET',undefined,headers)).value.etag,initial.etag);
    const events=logs.map(JSON.parse);
    assert.deepEqual(events.map(row=>row.event),['save_conflict','ai_failed','conversion_failed','upload_interrupted']);
    assert.equal(new Set(events.map(row=>row.session)).size,1);
    assert.ok(events.every(row=>row.revision===revision&&/^[0-9a-f]{24}$/.test(row.session)&&Number.isFinite(Date.parse(row.at))));
    for(const value of ['private prompt text','private conversion message','private-retry.pdf',headers.cookie,upload.id,'owner@example.test']){
      assert.ok(!logs.join('\n').includes(value));
    }
  }finally{await app.close()}
});

test('Staged release retains sign-in and reads, and checks the served commit, write mode and assets',async t=>{
  const folder=await workspace(t),logs=[];
  let app=await createStudioServer({dataDir:folder,origin,env:operationsEnv,pilotLog:line=>logs.push(line)});
  try{
    const {headers}=await setup(app,folder),initial=(await client(app).good('/api/state','PUT',createSeed(),{...headers,'If-None-Match':'*'})).value;
    await app.close();
    app=await createStudioServer({dataDir:folder,origin,env:{...operationsEnv,STUDIO_READ_ONLY:'1'},pilotLog:line=>logs.push(line)});
    const {call,good}=client(app);
    assert.equal((await good('/api/state','GET',undefined,headers)).value.workWrites,false);
    for(const [path,method] of [['/api/state','PUT'],['/api/snapshots','POST'],['/api/review-rooms','POST'],['/api/ai/generate','POST'],['/api/final-files','POST'],['/api/admin/ai','PATCH']]){
      const response=await call(path,method,{},headers);
      assert.equal(response.status,503);assert.equal((await response.json()).code,'workspace_read_only');
    }
    assert.equal((await good('/api/auth/login','POST',{email:'owner@example.test',password})).response.status,200);
    assert.equal((await good('/api/state','GET',undefined,headers)).value.etag,initial.etag);
    assert.deepEqual(logs,[]);
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=origin+':'+app.server.address().port;
    const result=await verifyRelease({origin:base,revision,mode:'read-only'});
    assert.equal(result.health.workWrites,false);assert.ok(result.assets.length>=10);
    await assert.rejects(()=>verifyRelease({origin:base,revision:'c'.repeat(40),mode:'read-only'}),/Git revision/);
    await assert.rejects(()=>verifyRelease({origin:base,revision,mode:'writable'}),/write mode/);
    await app.close();
    app=await createStudioServer({dataDir:folder,origin,env:operationsEnv});
    const saved=(await client(app).good('/api/state','PUT',createSeed(),{...headers,'If-Match':initial.etag})).value;
    assert.notEqual(saved.etag,initial.etag);
  }finally{await app.close()}
});
