import {siteAiAdminApi} from '../worker/site-ai.js';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {openDatabase,SqliteBucket} from './storage.mjs';
import {Auth,safeReturn} from './auth.mjs';
import {api} from '../worker/api.js';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf'};
const CSP="default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
async function persistentSecret(path,make){try{return (await readFile(path,'utf8')).trim()}catch(e){if(e.code!=='ENOENT')throw e;const secret=make();try{await writeFile(path,secret,{mode:0o600,flag:'wx'});return secret}catch(e){if(e.code!=='EEXIST')throw e;return (await readFile(path,'utf8')).trim()}}}
export async function createStudioServer(options={}){
 const config={...process.env,...options.env},dataDir=resolve(options.dataDir||config.DATA_DIR||config.RAILWAY_VOLUME_MOUNT_PATH||'data'),publicDir=resolve(options.publicDir||'dist/public');
 if(config.RAILWAY_ENVIRONMENT_ID){if(!config.RAILWAY_VOLUME_MOUNT_PATH)throw Error('Attach a Railway Volume at /data before starting this service.');const mount=resolve(config.RAILWAY_VOLUME_MOUNT_PATH);if(dataDir!==mount&&!dataDir.startsWith(mount+sep))throw Error('DATA_DIR must be on the Railway persistent volume.')}
 await mkdir(dataDir,{recursive:true,mode:0o700});const db=openDatabase(resolve(dataDir,'studio.sqlite'));
 const bootstrapToken=options.bootstrapToken||config.BOOTSTRAP_TOKEN||await persistentSecret(resolve(dataDir,'bootstrap-token'),()=>randomBytes(32).toString('hex'));
 if(bootstrapToken.length<32)throw Error('BOOTSTRAP_TOKEN must have at least 32 characters.');
 const aiSecret=config.AI_SECRET_ENCRYPTION_KEY||await persistentSecret(resolve(dataDir,'ai-encryption.key'),()=>randomBytes(32).toString('base64'));
 if(Buffer.from(aiSecret,'base64').length!==32)throw Error('AI_SECRET_ENCRYPTION_KEY must encode 32 bytes.');
 const origin=options.origin||config.PUBLIC_URL||(config.RAILWAY_PUBLIC_DOMAIN?'https://'+config.RAILWAY_PUBLIC_DOMAIN:'http://localhost:'+(config.PORT||3000));
 const canonical=new URL(origin);if(canonical.pathname!=='/'||canonical.search||canonical.hash||canonical.username||canonical.password)throw Error('PUBLIC_URL must be an origin without a path.');
 const auth=new Auth(db,{bootstrapToken,origin:canonical.origin}),bucket=new SqliteBucket(db),env={...config,AI_PROVIDER:config.AI_PROVIDER||'deepseek',AI_SECRET_ENCRYPTION_KEY:aiSecret,BUCKET:bucket};
 async function handle(request){
  const u=new URL(request.url);
  if(u.pathname==='/healthz'){db.prepare('SELECT 1').get();return json({ok:true,storage:'sqlite'})}
  if(['POST','PUT','PATCH','DELETE'].includes(request.method)&&request.headers.get('origin')!==auth.origin)return json({error:'不允许跨站修改。'},403);
  const authResponse=await auth.handle(request);if(authResponse)return authResponse;
  if(u.pathname==='/signin-with-chatgpt')return new Response(null,{status:302,headers:{Location:'/login?return_to='+encodeURIComponent(safeReturn(u.searchParams.get('return_to'))),'Cache-Control':'no-store'}});
  const headers=new Headers(request.headers);for(const name of [...headers.keys()])if(name.toLowerCase().startsWith('oai-'))headers.delete(name);
  const user=auth.user(request);const siteAdminResponse=await siteAiAdminApi(request,env,user,r=>auth.body(r));if(siteAdminResponse)return siteAdminResponse;if(user){headers.set('oai-authenticated-user-id',user.id);headers.set('oai-authenticated-user-name',encodeURIComponent(user.name));if(user.identityConfirmed)headers.set('oai-authenticated-user-email',user.email)}
  if(u.pathname.startsWith('/api/'))return api(new Request(request,{headers}),{...env,SITE_AI_ADMIN:user?.role==='admin'});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  let pathname;try{pathname=decodeURIComponent(u.pathname)}catch{return new Response('Invalid path',{status:400})}
  if(['login','register','setup','activate','account'].some(p=>pathname==='/'+p))pathname='/account.html';
  if(pathname==='/')pathname='/index.html';
  if(pathname==='/downloads/workshop.zip'){try{const body=Buffer.from(await readFile(resolve(publicDir,'downloads/workshop.zip.base64'),'utf8'),'base64');return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="gongchuang-workshop-html.zip"'}})}catch{return new Response('Not found',{status:404})}}
  const file=resolve(publicDir,'.'+pathname);if(!file.startsWith(publicDir+sep)||pathname.includes('\0'))return new Response('Not found',{status:404});
  try{const data=await readFile(file),ext=file.slice(file.lastIndexOf('.'));return new Response(request.method==='HEAD'?null:data,{headers:{'Content-Type':MIME[ext]||'application/octet-stream','Content-Length':String(data.length),'Cache-Control':'public, max-age=0, must-revalidate','Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}})}catch(e){if(['ENOENT','EISDIR','ENOTDIR'].includes(e.code))return new Response('Not found',{status:404});throw e}
 }
 const server=createServer(async(req,res)=>{try{
  if(Number(req.headers['content-length'])>35*1024*1024){res.writeHead(413);res.end('Request too large');req.resume();return}
  const url=new URL(req.url,auth.origin);if(url.origin!==auth.origin){res.writeHead(400);res.end('Invalid request URL');return}
  const controller=new AbortController();req.on('aborted',()=>controller.abort());const request=new Request(url,{method:req.method,headers:req.headers,signal:controller.signal,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
  const response=await handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));if(!response.body||req.method==='HEAD'){res.end();return}Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
 }catch(e){console.error('HTTP request failed:',e.name);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'服务暂时未完成请求，请稍后重试。'}))}});
 server.requestTimeout=180000;server.headersTimeout=15000;
 return {server,handle,db,bucket,auth,async close(){await new Promise((resolve,reject)=>server.listening?server.close(e=>e?reject(e):resolve()):resolve());db.close()}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const app=await createStudioServer();const port=Number(process.env.PORT)||3000;app.server.listen(port,'0.0.0.0',()=>console.log('Studio listening on port '+port));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref()})}
