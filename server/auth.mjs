import {randomBytes,createHash,timingSafeEqual,scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback),digest=s=>createHash('sha256').update(s).digest('hex');
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const email=s=>{s=String(s||'').trim().toLowerCase();if(s.length>254||/[^\x21-\x7e]/.test(s)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw Error('请填写有效的邮箱。');return s};
const password=s=>{if(typeof s!=='string'||s.length<10||s.length>128)throw Error('密码需要 10–128 个字符。');return s};
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
export function safeReturn(value){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\x00-\x1f]/.test(value)?value:'/' }
export class Auth{
 constructor(db,{bootstrapToken,origin}){this.db=db;this.origin=origin;this.bootstrapHash=digest(bootstrapToken);this.cookieName=origin.startsWith('https:')?'__Host-studio_session':'studio_session';this.secure=origin.startsWith('https:');db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),expires_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS account_invites(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,created_by TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);CREATE TABLE IF NOT EXISTS login_limits(identifier TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);`)}
 user(request){const cookies=request.headers.get('cookie')||'',token=cookies.split(';').map(x=>x.trim()).find(x=>x.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const row=this.db.prepare('SELECT a.id,a.email,a.name,a.role FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now());return row?{...row}:null}
 cookie(token,clear=false){return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:604800}${this.secure?'; Secure':''}`}
 session(user){const token=randomBytes(32).toString('hex');this.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+604800000);return this.cookie(token)}
 async hashPassword(value){const salt=randomBytes(16).toString('hex'),hash=await scrypt(password(value),salt,64);return {salt,hash:hash.toString('hex')}}
 async body(request){const chunks=[];let total=0;for await(const chunk of request.body||[]){total+=chunk.length;if(total>16384)throw Error('请求内容过大。');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 async handle(request){const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/auth/'))return null;const user=this.user(request),count=()=>this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
 try{
  if(path==='/api/auth/me'&&request.method==='GET')return json({user,setupRequired:count()===0,registration:'invitation'});
  if(request.method!=='POST')return json({error:'不支持此操作。'},405);
  if(request.headers.get('origin')!==this.origin)return json({error:'请在本站页面内操作。'},403);
  const data=await this.body(request);
  if(path==='/api/auth/setup'){
   if(count()!==0)return json({error:'工作坊已完成初始化。'},409);
   if(typeof data.token!=='string'||data.token.length>200||!equal(digest(data.token),this.bootstrapHash))return json({error:'初始化链接无效。'},403);
   const address=email(data.email),name=String(data.name||'工作坊管理员').trim().slice(0,80),hash=await this.hashPassword(data.password),id=randomBytes(16).toString('hex');
   this.db.exec('BEGIN IMMEDIATE');try{if(count()!==0)throw Error('工作坊已完成初始化。');this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(id,address,name,'admin',hash.salt,hash.hash,Date.now());this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
   return json({user:{id,email:address,name,role:'admin'}},201,{'Set-Cookie':this.session({id})});
  }
  if(path==='/api/auth/login'){
   const address=String(data.email||'').trim().toLowerCase().slice(0,254),identifier=digest(address),previous=this.db.prepare('SELECT * FROM login_limits WHERE identifier=?').get(identifier);
   if(previous?.reset_at>Date.now()&&previous.attempts>=8)return json({error:'尝试次数较多，请在 15 分钟后重试。'},429);
   const attempts=previous?.reset_at>Date.now()?previous.attempts+1:1,reset=previous?.reset_at>Date.now()?previous.reset_at:Date.now()+900000;
   this.db.prepare('INSERT INTO login_limits VALUES(?,?,?) ON CONFLICT(identifier) DO UPDATE SET attempts=excluded.attempts,reset_at=excluded.reset_at').run(identifier,attempts,reset);
   const account=this.db.prepare('SELECT * FROM accounts WHERE email=?').get(address),pw=typeof data.password==='string'&&data.password.length<=128?data.password:'',hash=(await scrypt(pw,account?.salt||'00000000000000000000000000000000',64)).toString('hex');
   if(!account||!equal(hash,account.password_hash))return json({error:'邮箱或密码不正确。'},401);
   this.db.prepare('DELETE FROM login_limits WHERE identifier=?').run(identifier);return json({user:{id:account.id,email:account.email,name:account.name,role:account.role}},200,{'Set-Cookie':this.session(account)});
  }
  if(path==='/api/auth/logout'){
   const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1);
   if(token)this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));return json({signedOut:true},200,{'Set-Cookie':this.cookie('',true)});
  }
  if(path==='/api/auth/invite'){
   if(user?.role!=='admin')return json({error:'只有工作坊管理员可以邀请新账号。'},403);
   const address=email(data.email);if(this.db.prepare('SELECT id FROM accounts WHERE email=?').get(address))return json({error:'这个邮箱已有工作坊账号。'},409);
   const token=randomBytes(32).toString('hex');this.db.prepare('INSERT INTO account_invites VALUES(?,?,?,?,NULL)').run(digest(token),address,user.id,Date.now()+604800000);
   return json({email:address,activationUrl:this.origin+'/activate#token='+token,expiresAt:new Date(Date.now()+604800000).toISOString()},201);
  }
  if(path==='/api/auth/activate'){
   const token=String(data.token||'');if(!/^[a-f0-9]{64}$/.test(token))return json({error:'账号邀请无效。'},403);
   const invite=this.db.prepare('SELECT * FROM account_invites WHERE token_hash=?').get(digest(token));if(!invite||invite.used_at||invite.expires_at<Date.now())return json({error:'邀请已使用或已过期。'},403);
   const name=String(data.name||'工作坊成员').trim().slice(0,80),hash=await this.hashPassword(data.password),id=randomBytes(16).toString('hex');
   this.db.exec('BEGIN IMMEDIATE');try{const current=this.db.prepare('SELECT * FROM account_invites WHERE token_hash=?').get(digest(token));if(!current||current.used_at||current.expires_at<Date.now())throw Error('邀请已使用或已过期。');this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(id,current.email,name,'member',hash.salt,hash.hash,Date.now());this.db.prepare('UPDATE account_invites SET used_at=? WHERE token_hash=?').run(Date.now(),digest(token));this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
   return json({user:{id,email:invite.email,name,role:'member'}},201,{'Set-Cookie':this.session({id})});
  }
  return json({error:'账号接口不存在。'},404);
 }catch(e){return json({error:e instanceof SyntaxError?'请求格式不正确。':/UNIQUE constraint/.test(e.message)?'该邮箱已有工作坊账号。':/密码需要|有效的邮箱|初始化|邀请已|请求内容/.test(e.message)?e.message:'账号操作未完成，请稍后重试。'},400)}
 }
}
