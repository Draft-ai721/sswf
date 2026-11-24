export async function extractTaskText(file){if(!/\.pdf$/i.test(file.name))return '';const pdf=await import('./vendor/pdf.mjs');pdf.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';const task=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/pdf-cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-fonts/',isEvalSupported:false,useSystemFonts:true});let document;try{document=await task.promise;const parts=[];let length=0;for(let n=1;n<=Math.min(10,document.numPages)&&length<12000;n++){const page=await document.getPage(n),content=await page.getTextContent();const text=content.items.filter(item=>typeof item.str==='string').map(item=>item.str).join(' ');parts.push('第 '+n+' 页\n'+text);length+=text.length;page.cleanup()}const text=parts.join('\n\n').slice(0,12000);return text.replace(/第 \d+ 页/g,'').trim().length>10?text:''}finally{await document?.destroy();if(!document)await task.destroy()}}

// A final review can send the cover to an image-capable model alongside extracted PDF text.
export async function reviewCover(file) {
  const lib=await import('./vendor/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
  const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,cMapUrl:'/pdf-cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-fonts/'});
  try{
    const pdf=await task.promise,page=await pdf.getPage(1),base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(2,1500/Math.max(base.width,base.height))});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
    return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));
  }finally{await task.destroy()}
}
