import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const assets=['index.html','app.js','studio.js','review-rooms.js','final-review.js','final-archive.js','skp-worker.js',
  'shared/plan-geometry.js','shared/program-requirements.js','shared/studio-preview.js'];
const digest=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');

export async function verifyRelease({origin,revision,mode,publicDir='dist/public'}){
  const base=new URL(origin);
  if(base.pathname!=='/'||base.search||base.hash||base.username||base.password||
     !(base.protocol==='https:'||base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))){
    throw Error('Provide an HTTPS origin or an HTTP loopback test origin.');
  }
  if(!/^[a-f0-9]{7,64}$/.test(revision||'')||!['read-only','writable'].includes(mode))throw Error('Provide a Git revision and read-only or writable mode.');
  async function get(path){
    const response=await fetch(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(path+' returned HTTP '+response.status+'.');
    return response;
  }
  const health=await (await get('/healthz')).json();
  if(!health.ok||health.storage!=='sqlite'||health.revision!==revision){
    throw Error('Health check did not report the expected SQLite service and Git revision.');
  }
  if((health.workWrites===false)!==(mode==='read-only'))throw Error('The deployed write mode does not match the release step.');
  const login=await get('/login');
  if(!(login.headers.get('content-type')||'').includes('text/html'))throw Error('The configured sign-in page is unavailable.');
  const checks=await Promise.all(assets.map(async name=>{
    const [local,remote]=await Promise.all([readFile(resolve(publicDir,name),'utf8'),get('/'+name).then(response=>response.text())]);
    const sha256=digest(remote);
    if(sha256!==digest(local))throw Error('Built asset differs from the served asset: '+name);
    return {name,sha256};
  }));
  return {checkedAt:new Date().toISOString(),origin:base.origin,revision,mode,health,loginStatus:login.status,assets:checks};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [origin,revision,mode]=process.argv.slice(2);
  try{console.log(JSON.stringify(await verifyRelease({origin,revision,mode}),null,2))}
  catch(error){console.error(error.message);process.exitCode=1}
}
