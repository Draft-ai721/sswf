import {convert} from './conversion.js';
self.onmessage=async({data})=>{try{const r=await convert(data.buffer,p=>self.postMessage({type:'progress',...p}));self.postMessage({type:'complete',buffer:r.glb.buffer,metadata:r.metadata,sourceSha256:r.sourceSha256},[r.glb.buffer]);}catch(e){self.postMessage({type:'error',message:String(e.message||'模型转换失败').slice(0,800)})}};
