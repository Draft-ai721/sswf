const DB_NAME='studio-draft-recovery';

export function draftSaveNotice(className){
  return `<div class="${className}" data-save-conflict hidden role="alert"><span></span>
    <button type="button" class="draft-download" data-action="download-draft">下载未保存草稿</button>
    <button type="button" class="draft-download" data-action="retry-save" hidden>重试保存</button></div>`;
}

export function createDraftRecovery() {
  let database;
  const tabId=crypto.randomUUID();

  function open() {
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{
        const drafts=request.result.createObjectStore('drafts',{keyPath:'key'});
        drafts.createIndex('account','account');
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('本机草稿存储暂不可用。'));
    });
    return database;
  }

  async function transaction(mode,operation) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode);
      const request=operation(tx.objectStore('drafts'));
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=()=>reject(tx.error);
    });
  }

  return {
    async put({account,projectId,optionId,baseETag,payload}) {
      const record={key:[account,projectId,optionId,baseETag||'',tabId],account,projectId,optionId,
        baseETag,payload,updatedAt:Date.now()};
      await transaction('readwrite',store=>store.put(record));
      return record;
    },
    clear(record) {
      return transaction('readwrite',store=>store.delete(record.key));
    },
    async list(account) {
      const rows=await transaction('readonly',store=>store.index('account').getAll(account));
      return rows.sort((a,b)=>b.updatedAt-a.updatedAt);
    }
  };
}
