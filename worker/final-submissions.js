import {modelSnapshot} from './models.js';

// Final submissions have their own immutable work, independent of editable projects.
export async function createFinalSubmission(bucket, prefix, data, state, reject) {
  const title = typeof data.title === 'string' && data.title.trim();
  const focus = data.focus ?? '';
  if (!title || title.length > 100 || typeof focus !== 'string' || focus.length > 3000)
    throw reject('请填写作品名称，关注问题最多 3000 字。');
  const course = {name:'最终评审', brief:'', focus:''};
  const files = [];
  let drawing = null;
  if (data.versionId) {
    const version = state?.projects.find(p => p.id === data.projectId)?.versions.find(v => v.id === data.versionId);
    const option = version?.snapshot.workflow?.options.find(o => o.id === data.optionId);
    if (!option?.plan) throw reject('请选择已保存版本中的一个平面方案。');
    drawing = {title:option.title, plan:option.plan, program:(version.snapshot.workflow.program || []).map(({id,name}) => ({id,name}))};
  } else {
    if (!Array.isArray(data.files) || !data.files.length || data.files.length > 3)
      throw reject('请选择一至三份作品材料。');
    const ids = new Set();
    for (const item of data.files) {
      if (!item || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) throw reject('作品材料无效。');
      ids.add(item.id);
      const obj = await bucket.head(prefix+'files/'+item.id);
      const meta = obj?.customMetadata;
      if (meta?.purpose !== 'final' || !['jpg','png','pdf','skp'].includes(meta.type)) throw reject('材料不属于本次可提交的作品。');
      const extractedText = typeof item.extractedText === 'string' && meta.type === 'pdf' ? item.extractedText.slice(0,12000) : '';
      let previewId=null;
      if(item.previewId){
        if(!/^[a-zA-Z0-9-]{1,80}$/.test(item.previewId))throw reject('预览材料无效。');
        const cover=await bucket.head(prefix+'files/'+item.previewId);
        if(cover?.customMetadata?.purpose!=='final'||cover.customMetadata.parentId!==item.id||cover.customMetadata.type!=='jpg'||cover.customMetadata.page!=='1')throw reject('预览页与原文件不符。');
        previewId=item.previewId;
      }
      const conversion=meta.type==='skp'?await modelSnapshot(bucket,prefix,item.id):null;
      files.push({...(conversion?{conversion}:{}),id:item.id, type:meta.type, name:decodeURIComponent(meta.name), extractedText,...(previewId?{previewId}:{})});
    }
  }
  const id = crypto.randomUUID(), createdAt = new Date().toISOString();
  const snapshot = {id, name:title, description:focus, goal:'', users:'', report:focus, reason:'', evidence:'', reflection:'', files, feedback:[], questions:[]};
  if (drawing) snapshot.drawing = drawing;
  return {id,title,kind:'final',course,createdAt,version:{id:crypto.randomUUID(),number:1,label:'提交作品',createdAt,snapshot}};
}

// Only return the published review and its cited evidence, never the private provider payload.
export async function finalAiResult(bucket, room) {
  const index = await bucket.get(room.ownerPrefix+'ai/index/final-'+room.id+'.json');
  for (const entry of index ? await index.json() : []) {
    const raw = await bucket.get(room.ownerPrefix+'ai/runs/'+entry.id+'.json');
    const run = raw && await raw.json();
    if (run?.finalRoomId !== room.id || run.status !== 'succeeded') continue;
    return {provider:run.provider, model:run.model, createdAt:run.createdAt, comments:run.output.comments.map(c => {
      const source = run.sources.find(s => s.id === c.sourceId);
      return {...c, location:source?.label || '', fileId:source?.fileId || null};
    })};
  }
  return null;
}
