import {esc} from './materials.js';

export function pdfSheet(room,file,page,base='/api/review-rooms/'+room.id) {
  return `<div class="pdf-sheet" data-pdf-sheet data-file="${esc(file.id)}" data-page="${page}">
    <div class="pdf-tools"><button type="button" data-page-step="-1" disabled>上一页</button><output aria-live="polite">读取中…</output><button type="button" data-page-step="1" disabled>下一页</button>
    <label>缩放 <select aria-label="图纸缩放"><option value="1">适宽</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div>
    <div class="pdf-scroller"><div class="pdf-surface"><canvas aria-label="${esc(file.name)}"></canvas><div class="pdf-pins"></div></div></div>
    <a class="btn text" href="${base}/files/${file.id}" download>下载原件</a></div>`;
}
export function mountPdfSheet(el,room,onPoint,onPage,base='/api/review-rooms/'+room.id) {
  let disposed=false,loading,pdf,job,sequence=0;
  const surface=el.querySelector('.pdf-surface'),canvas=el.querySelector('canvas'),out=el.querySelector('output');
  const pins=el.querySelector('.pdf-pins'),zoom=el.querySelector('select');
  let page=Number(el.dataset.page)||1;
  async function draw(){
    const stamp=++sequence;
    const previous=job;
    previous?.cancel();
    if(previous)await previous.promise.catch(()=>{});
    if(disposed||stamp!==sequence)return;
    try {
      page=Math.min(pdf.numPages,Math.max(1,page));onPage(page);
      const sheet=await pdf.getPage(page);if(disposed||stamp!==sequence)return;
      const scale=Number(zoom.value),base=sheet.getViewport({scale:1});
      const width=Math.max(220,el.clientWidth)*scale;
      const viewport=sheet.getViewport({scale:Math.min(width*1.5/base.width,3000/Math.max(base.width,base.height))});
      surface.style.width=(scale*100)+'%';canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      pins.innerHTML='';
      job=sheet.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'});await job.promise;
      if(disposed||stamp!==sequence)return;
      out.textContent='第 '+page+' / '+pdf.numPages+' 页';
      for(const btn of el.querySelectorAll('[data-page-step]'))btn.disabled=page+Number(btn.dataset.pageStep)<1||page+Number(btn.dataset.pageStep)>pdf.numPages;
      pins.innerHTML=room.comments.filter(c=>c.source===el.dataset.file&&c.imagePoint?.page===page).map((c,i)=>`<button class="room-image-pin" data-action="room-locate" data-id="${esc(c.id)}" aria-label="${esc(c.text)}" style="left:${c.imagePoint.x*100}%;top:${c.imagePoint.y*100}%">${i+1}</button>`).join('');
    }catch(e){if(!disposed&&stamp===sequence)out.textContent='图页读取失败，可下载原件。'}
  }
  for(const btn of el.querySelectorAll('[data-page-step]'))btn.onclick=()=>{page+=Number(btn.dataset.pageStep);draw()};
  zoom.onchange=()=>draw();
  if(room.role==='reviewer')canvas.onclick=e=>{if(!pdf)return;const b=canvas.getBoundingClientRect();onPoint(el.dataset.file,null,{x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height,page})};
  (async()=>{
    try{const lib=await import('./vendor/pdf.mjs');if(disposed)return;lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
      loading=lib.getDocument({url:base+'/files/'+el.dataset.file,cMapUrl:'/pdf-cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-fonts/',isEvalSupported:false});
      pdf=await loading.promise;if(!disposed)await draw();
    }catch{if(!disposed)out.textContent='图纸未能预览，可下载原件。'}
  })();
  return ()=>{disposed=true;job?.cancel();loading?.destroy().catch(()=>{})};
}
