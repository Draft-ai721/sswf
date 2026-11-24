import {initializeModel} from './models.js';

export async function uploadMaterial(request, url, bucket, prefix, {readState,limitedBody,maxFile,json,fail}) {
  const final = url.pathname === '/api/final-files';
  const name = url.searchParams.get('name') || '';
  const project = final ? 'final-upload' : url.searchParams.get('project');
  const ext = name.split('.').pop().toLowerCase();
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(project || '') || !name || name.length > 200) return fail('文件信息无效。');
  const type = ext === 'jpeg' ? 'jpg' : ext;
  if (!['pdf','jpg','png',...(final?[]:['skp'])].includes(type)) return fail(final?'终评支持 PDF、JPG 与 PNG。':'支持 SKP、PDF、JPG 与 PNG 文件。');
  const state = final ? null : (await readState()).state;
  const draft = state?.projects.find(p=>p.id===project);
  if (!final && !draft) return fail('请先保存项目，再上传材料。',404);
  const bytes = await limitedBody(request,maxFile);
  if (!bytes.length) return fail('不能上传空文件。');
  if (type==='pdf' && new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-') return fail('文件内容不是有效的 PDF 文件。');
  if (type==='png' && !(bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71)) return fail('文件内容不是有效的 PNG 文件。');
  if (type==='jpg' && !(bytes[0]===255 && bytes[1]===216)) return fail('文件内容不是有效的 JPEG 文件。');
  const parentId=url.searchParams.get('parentId'),page=Number(url.searchParams.get('page'));
  let derivedFrom=null;
  if(parentId){
    const parent=/^[a-zA-Z0-9-]{1,80}$/.test(parentId) && await bucket.head(prefix+'files/'+parentId);
    const meta=parent?.customMetadata;
    const validParent=final?meta?.purpose==='final':draft.files.some(f=>f.id===parentId && f.type==='pdf');
    if(!validParent || meta?.type!=='pdf' || meta.project!==project || !['jpg','png'].includes(type) || !Number.isInteger(page) || page<1 || page>2000)
      return fail('PDF 页来源无效。');
    derivedFrom={fileId:parentId,page};
  }
  const id=crypto.randomUUID();
  const metadata={name:encodeURIComponent(name),type,project,...(final?{purpose:'final'}:{}),...(parentId?{parentId,page:String(page)}:{})};
  const contentType={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',skp:'application/octet-stream'}[type];
  await bucket.put(prefix+'files/'+id,bytes,{customMetadata:metadata,httpMetadata:{contentType}});
  if(type==='skp')await initializeModel(bucket,prefix,id,bytes);
  return json({file:{id,name,type,size:bytes.length,uploadedAt:new Date().toISOString(),status:type==='skp'?'uploaded':'ready',projectId:project,...(derivedFrom?{derivedFrom}:{})}},201);
}
