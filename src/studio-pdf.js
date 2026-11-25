async function extractPdfPages(file){
  const lib=await import('./vendor/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
  const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/pdf-cmaps/',cMapPacked:true,
    standardFontDataUrl:'/pdf-fonts/',isEvalSupported:false,useSystemFonts:true});
  try{
    const pdf=await task.promise,pdfPages=[];
    let length=0,pdfTruncated=pdf.numPages>10;
    for(let page=1;page<=Math.min(10,pdf.numPages);page++){
      if(length===12000){pdfTruncated=true;break}
      const sheet=await pdf.getPage(page),content=await sheet.getTextContent();
      const full=content.items.filter(item=>typeof item.str==='string').map(item=>item.str).join(' ');
      const text=full.slice(0,12000-length);
      pdfPages.push({page,text});
      pdfTruncated||=text.length<full.length;
      length+=text.length;
      sheet.cleanup();
    }
    return {pdfPages,pdfPageCount:pdf.numPages,pdfTruncated};
  }finally{await task.destroy()}
}

export const extractReviewPdf=extractPdfPages;

export async function extractTaskText(file){
  if(!/\.pdf$/i.test(file.name))return '';
  const {pdfPages}=await extractPdfPages(file);
  if(pdfPages.map(row=>row.text).join('').trim().length<=10)return '';
  return pdfPages.map(row=>'第 '+row.page+' 页\n'+row.text).join('\n\n').slice(0,12000);
}

export async function readRequirementPage(url,number) {
  const lib=await import('./vendor/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
  const task=lib.getDocument({url,isEvalSupported:false,cMapUrl:'/pdf-cmaps/',
    cMapPacked:true,standardFontDataUrl:'/pdf-fonts/',useSystemFonts:true});
  try{
    const pdf=await task.promise;
    if(number<1||number>pdf.numPages)throw Error('这份 PDF 有 '+pdf.numPages+' 页。');
    const page=await pdf.getPage(number), base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(2,1300/Math.max(base.width,base.height))});
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const [content]=await Promise.all([page.getTextContent(),
      page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise]);
    const text=content.items.filter(item=>typeof item.str==='string')
      .map(item=>item.str+(item.hasEOL?'\n':' ')).join('').slice(0,24000);
    return {canvas,text};
  }finally{await task.destroy()}
}

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
