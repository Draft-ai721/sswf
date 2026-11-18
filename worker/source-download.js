// A delivery link is a time-limited capability. Only its digest is deployed.
const route='/downloads/source-v6.zip';
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export async function sourceDownload(request,delivery){
 const url=new URL(request.url);
 if(url.pathname!==route)return null;
 const headers={'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"};
 const token=url.searchParams.get('token');
 const validConfig=delivery&&typeof delivery.archive==='string'&&/^[a-f0-9]{64}$/.test(delivery.tokenSha256||'')&&Number.isFinite(Date.parse(delivery.expiresAt));
 if(!validConfig||!token||!/^[a-f0-9]{64}$/.test(token))return new Response('Download link is invalid.',{status:404,headers});
 const digest=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
 if(digest!==delivery.tokenSha256)return new Response('Download link is invalid.',{status:404,headers});
 if(Date.now()>=Date.parse(delivery.expiresAt))return new Response('Download link has expired. Please request a new link.',{status:410,headers});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405,headers:{...headers,Allow:'GET, HEAD'}});
 let body=null;
 if(request.method!=='HEAD'){const raw=atob(delivery.archive);body=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)body[i]=raw.charCodeAt(i)}
 return new Response(body,{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="gongchuang-design-studio-v6-source.zip"','Content-Length':String(delivery.byteLength),'X-Archive-SHA256':delivery.sha256}});
}
