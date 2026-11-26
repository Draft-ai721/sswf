import {createHmac} from 'node:crypto';

const aiCodes=new Set(['provider_network','provider_redirect','provider_auth','provider_quota','provider_error',
  'provider_format','provider_refusal','invalid_output','incomplete_output','storage_error','storage_busy',
  'busy','daily_limit','site_limit','site_busy','bad_view','model_changed','state_conflict','not_configured','bad_final_version']);
const uploads=new Set(['/api/files','/api/final-files']);

export function releaseRevision(config){
  return [config.RAILWAY_GIT_COMMIT_SHA,config.STUDIO_RELEASE_REVISION]
    .find(value=>typeof value==='string'&&/^[a-f0-9]{7,64}$/.test(value))||null;
}

export function pilotRecorder({enabled,key,revision,cookieName,sink=line=>console.info(line)}){
  if(!enabled)return async()=>{};
  const sessionKey=createHmac('sha256',key).update('studio-pilot-session-v1').digest();
  return async (request,response)=>{
    const {pathname}=new URL(request.url),status=response.status;
    let event,code;
    if(request.method==='PUT'&&pathname==='/api/state'&&status===409){
      const {code:conflict}=await response.clone().json();
      event='save_conflict';code=conflict==='geometry_version'?'geometry_version':'state_conflict';
    }else if(request.method==='POST'&&pathname==='/api/ai/generate'&&status>=400){
      const rejected=await response.clone().json();
      if(rejected.code==='workspace_read_only')return;
      event='ai_failed';code=aiCodes.has(rejected.code)?rejected.code:'request_rejected';
    }else if(['POST','PUT'].includes(request.method)&&/^\/api\/models\/[a-zA-Z0-9-]+\/progress$/.test(pathname)&&response.ok){
      const {model}=await response.clone().json();
      if(model?.status!=='failed')return;
      event='conversion_failed';code='conversion_failed';
    }else if(request.method==='POST'&&uploads.has(pathname)&&request.signal.aborted){
      event='upload_interrupted';code='request_aborted';
    }
    if(!event)return;
    const token=(request.headers.get('cookie')||'').split(';').map(part=>part.trim())
      .find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!token||!/^[a-f0-9]{64}$/.test(token))return;
    const session=createHmac('sha256',sessionKey).update(token).digest('hex').slice(0,24);
    sink(JSON.stringify({type:'studio_pilot',event,code,status,revision:revision||'local',session,at:new Date().toISOString()}));
  };
}
