import {DatabaseSync,backup} from 'node:sqlite';
import {createReadStream,constants} from 'node:fs';
import {readFile,writeFile,mkdir,copyFile,realpath,lstat,chmod} from 'node:fs/promises';
import {basename,dirname,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {releaseRevision} from './pilot-events.mjs';
import {decrypt} from '../worker/ai-secrets.js';

const database='studio.sqlite',manifestFile='backup.json';
const credentialNames=[['ai-encryption.key','AI_SECRET_ENCRYPTION_KEY'],['bootstrap-token','BOOTSTRAP_TOKEN']];
const sha=value=>createHash('sha256').update(value).digest('hex');

async function fileHash(filename){
  const info=await lstat(filename);
  if(!info.isFile())throw Error('Expected a regular file in the recovery directory.');
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(filename))digest.update(chunk);
  return {bytes:info.size,sha256:digest.digest('hex')};
}

async function createPrivateDirectory(source,destination){
  const target=resolve(await realpath(dirname(resolve(destination))),basename(resolve(destination)));
  const path=relative(source,target);
  if(!path||(!isAbsolute(path)&&path!=='..'&&!path.startsWith('../')&&!path.startsWith('..\\'))){
    throw Error('Choose a new recovery directory outside the source directory.');
  }
  await mkdir(target,{mode:0o700});
  return target;
}

function inspect(db){
  if(db.prepare('PRAGMA integrity_check(1)').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get()){
    throw Error('SQLite integrity or foreign-key check failed.');
  }
  const read=db.prepare('SELECT data FROM objects WHERE key=?');
  const exists=db.prepare('SELECT 1 FROM objects WHERE key=?');
  const summary={accounts:db.prepare('SELECT count(*) AS total FROM accounts').get().total,
    objects:db.prepare('SELECT count(*) AS total FROM objects').get().total,
    projects:0,projectVersions:0,rooms:0,roomVersions:0,missingVersions:0,missingMaterials:0,invalidRecords:0};
  const decode=value=>{
    try{return JSON.parse(Buffer.from(value).toString('utf8'))}catch{summary.invalidRecords++;return null}
  };
  const assets=(snapshot,prefix,conversions={})=>{
    if(!Array.isArray(snapshot?.files)||typeof prefix!=='string'){summary.invalidRecords++;return}
    for(const file of snapshot.files){
      if(!file?.id){summary.invalidRecords++;continue}
      if(!exists.get(prefix+'files/'+file.id))summary.missingMaterials++;
      if(file.previewId&&!exists.get(prefix+'files/'+file.previewId))summary.missingMaterials++;
      const model=conversions[file.id]||file.conversion;
      if(model?.status==='ready'&&!exists.get(prefix+'models/'+file.id+'/results/'+model.resultId+'.glb'))summary.missingMaterials++;
    }
  };
  for(const {key,data} of db.prepare(`SELECT key,data FROM objects
    WHERE (key LIKE 'users/%/state.json' AND instr(substr(key,7),'/')=length(substr(key,7))-10)
       OR (key LIKE 'review-rooms/%.json' AND instr(substr(key,14),'/')=0)`).iterate()){
    const value=decode(data);
    if(!value)continue;
    if(key.startsWith('users/')){
      if(!Array.isArray(value.projects)){summary.invalidRecords++;continue}
      const prefix=key.slice(0,-'state.json'.length);
      for(const project of value.projects){
        summary.projects++;assets(project,prefix);
        for(const version of project?.versions||[]){summary.projectVersions++;assets(version?.snapshot,prefix)}
      }
      continue;
    }
    summary.rooms++;
    const first=value.version;
    if(!first?.id){summary.invalidRecords++;continue}
    summary.roomVersions++;
    assets(first.snapshot,value.ownerPrefix,{...value.modelResults,...value.versionModels?.[first.id]});
    const versions=new Set([first.id]);
    for(const row of value.sharedVersions||[]){
      const object=read.get('review-rooms/'+value.id+'/versions/'+row.id+'.json');
      const version=object&&decode(object.data);
      if(version?.id!==row.id){summary.missingVersions++;continue}
      summary.roomVersions++;versions.add(version.id);
      assets(version.snapshot,value.ownerPrefix,value.versionModels?.[version.id]);
    }
    for(const comment of value.comments||[]){
      if(comment.versionId&&!versions.has(comment.versionId))summary.missingVersions++;
      for(const reply of comment.replies||[]){
        if(reply.responseVersionId&&!versions.has(reply.responseVersionId))summary.missingVersions++;
        if(reply.files?.length)assets(reply,value.ownerPrefix);
      }
      if(comment.point?.imageId&&!exists.get('review-rooms/'+value.id+'/evidence/'+(comment.versionId||first.id)+'/'+comment.point.imageId)){
        summary.missingMaterials++;
      }
    }
  }
  return summary;
}

async function localCredential(source,name,variable,env){
  const supplied=env[variable];
  if(supplied)return {mode:'environment',...credentialFingerprint(name,supplied)};
  const path=resolve(source,name);
  let content;
  try{await fileHash(path);content=await readFile(path,'utf8')}catch(error){
    if(error.code==='ENOENT'&&name==='bootstrap-token')return {mode:'absent'};
    throw error;
  }
  return {mode:'file',...credentialFingerprint(name,content.trim())};
}

function credentialFingerprint(name,value){
  if(name==='ai-encryption.key'&&Buffer.from(value,'base64').length!==32||name==='bootstrap-token'&&value.length<32){
    throw Error('A required recovery credential has an invalid format.');
  }
  return {sha256:sha(value)};
}

export async function createBackup(sourceDir,backupDir,env=process.env){
  const source=await realpath(sourceDir),sourceFile=resolve(source,database);
  if(!(await lstat(sourceFile)).isFile())throw Error('Source SQLite database is missing.');
  const credentials={};
  for(const [name,variable] of credentialNames)credentials[name]=await localCredential(source,name,variable,env);
  const destination=await createPrivateDirectory(source,backupDir);
  const target=resolve(destination,database),sourceDb=new DatabaseSync(sourceFile,{readOnly:true});
  try{await backup(sourceDb,target)}finally{sourceDb.close()}
  const snapshot=new DatabaseSync(target);
  try{snapshot.exec('PRAGMA journal_mode=DELETE');inspect(snapshot)}finally{snapshot.close()}
  await chmod(target,0o600);
  for(const [name] of credentialNames)if(credentials[name].mode==='file'){
    const file=resolve(destination,name);
    const contents=await readFile(resolve(source,name),'utf8');
    if(sha(contents.trim())!==credentials[name].sha256)throw Error('Recovery credential changed during backup.');
    await writeFile(file,contents,{flag:'wx',mode:0o600});
  }
  const manifest={format:1,createdAt:new Date().toISOString(),revision:releaseRevision(env),database:await fileHash(target),credentials};
  await writeFile(resolve(destination,manifestFile),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return verifyBackup(destination,env);
}

async function checkBackup(directory,env){
  const folder=await realpath(directory);
  const manifest=JSON.parse(await readFile(resolve(folder,manifestFile),'utf8'));
  if(manifest.format!==1)throw Error('Unknown SQLite backup format.');
  const actual=await fileHash(resolve(folder,database));
  if(actual.sha256!==manifest.database?.sha256||actual.bytes!==manifest.database.bytes){
    throw Error('SQLite backup checksum mismatch.');
  }
  for(const [name,variable] of credentialNames){
    const expected=manifest.credentials?.[name];
    if(expected?.mode==='absent'&&name==='bootstrap-token')continue;
    if(!['file','environment'].includes(expected?.mode))throw Error('Recovery credential record is missing.');
    const envValue=expected.mode==='environment'?env[variable]:null;
    if(expected.mode==='environment'&&!envValue)throw Error('Supply '+variable+' from the original secret store.');
    const fingerprint=await localCredential(folder,name,variable,envValue?{[variable]:envValue}:{});
    if(fingerprint.sha256!==expected.sha256)throw Error('Recovery credential does not match the backup.');
    if(expected.mode==='file'&&env[variable]&&credentialFingerprint(name,env[variable]).sha256!==expected.sha256){
      throw Error('A configured credential would override '+name+' with a different value.');
    }
  }
  const aiKey=manifest.credentials['ai-encryption.key'].mode==='environment'?env.AI_SECRET_ENCRYPTION_KEY:
    (await readFile(resolve(folder,'ai-encryption.key'),'utf8')).trim();
  const db=new DatabaseSync(resolve(folder,database),{readOnly:true});
  try{
    const summary=inspect(db);
    summary.unreadableConnections=0;
    for(const row of db.prepare("SELECT key,data FROM objects WHERE key LIKE '%/ai/connection.json'").iterate()){
      try{
        const record=JSON.parse(Buffer.from(row.data).toString('utf8'));
        if(!record.disconnected)await decrypt({AI_SECRET_ENCRYPTION_KEY:aiKey},row.key.slice(0,-'ai/connection.json'.length),record);
      }catch{summary.unreadableConnections++}
    }
    return {folder,manifest,summary};
  }finally{db.close()}
}

const publicInfo=({manifest,summary})=>({createdAt:manifest.createdAt,revision:manifest.revision,database:manifest.database,...summary});
export async function verifyBackup(directory,env=process.env){return publicInfo(await checkBackup(directory,env))}

export async function restoreBackup(backupDir,restoreDir,env=process.env){
  const {folder,manifest}=await checkBackup(backupDir,env);
  const destination=await createPrivateDirectory(folder,restoreDir);
  for(const name of [database,...credentialNames.map(item=>item[0]).filter(name=>manifest.credentials[name].mode==='file'),manifestFile]){
    const target=resolve(destination,name);
    await copyFile(resolve(folder,name),target,constants.COPYFILE_EXCL);
    await chmod(target,0o600);
  }
  return verifyBackup(destination,env);
}

function category(key){
  if(key.startsWith('review-rooms/')||key.endsWith('/review-rooms.json')||key.startsWith('review-invites/'))return 'reviews';
  if(key.endsWith('/state.json'))return 'projectStates';
  if(key.includes('/files/')||key.includes('/models/'))return 'materials';
  if(key.includes('/ai/')||key.startsWith('site-ai/'))return 'ai';
  return 'other';
}

function tally(oldRows,newRows,group){
  const counts={};
  const increment=(key,change)=>{
    const name=group(key);
    counts[name]??={added:0,changed:0,removed:0};
    counts[name][change]++;
  };
  const baseline=new Map(oldRows);
  for(const [key,etag] of newRows){
    if(!baseline.has(key))increment(key,'added');
    else if(baseline.get(key)!==etag)increment(key,'changed');
    baseline.delete(key);
  }
  for(const key of baseline.keys())increment(key,'removed');
  return counts;
}

function databaseInventory(filename){
  const db=new DatabaseSync(filename,{readOnly:true});
  try{
    db.exec('BEGIN');
    const objects=db.prepare('SELECT key,etag FROM objects').all().map(row=>[row.key,row.etag]);
    const accounts=db.prepare('SELECT * FROM accounts').all().map(row=>[row.id,sha(JSON.stringify(row))]);
    return {objects,accounts};
  }finally{db.close()}
}

export async function compareWithBackup(backupDir,currentDir,env=process.env){
  const {folder,manifest}=await checkBackup(backupDir,env);
  const baseline=databaseInventory(resolve(folder,database)),current=databaseInventory(resolve(await realpath(currentDir),database));
  const changes={...tally(baseline.objects,current.objects,category),...tally(baseline.accounts,current.accounts,()=> 'accounts')};
  return {backupAt:manifest.createdAt,changes,differs:Object.keys(changes).length>0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [command,...args]=process.argv.slice(2);
  const commands={backup:[2,createBackup],verify:[1,verifyBackup],restore:[2,restoreBackup],compare:[2,compareWithBackup]};
  const entry=Object.hasOwn(commands,command)&&commands[command];
  try{
    if(!entry||args.length!==entry[0])throw Error('Usage: node server/recovery.mjs backup <data> <new-backup> | verify <backup> | restore <backup> <new-data> | compare <backup> <current-data>');
    const result=await entry[1](...args);
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.message);process.exitCode=1}
}
