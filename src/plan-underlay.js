import {calibrateUnderlay} from '../shared/plan-underlay.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

async function drawingImage(file, page) {
  const response = await fetch('/api/files/' + file.id + '?preview=1');
  if (!response.ok) throw Error('无法读取底图，请重新登录或检查材料。');
  const blob = await response.blob();
  if (file.type !== 'pdf') {
    const image = await createImageBitmap(blob);
    try { return {width:image.width, height:image.height}; }
    finally { image.close(); }
  }
  const lib = await import('./vendor/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
  const task = lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()), isEvalSupported:false,
    cMapUrl:'/pdf-cmaps/', cMapPacked:true, standardFontDataUrl:'/pdf-fonts/'});
  try {
    const pdf = await task.promise;
    if (page > pdf.numPages) throw Error('PDF 只有 ' + pdf.numPages + ' 页。');
    const sheet = await pdf.getPage(page), base = sheet.getViewport({scale:1});
    const viewport = sheet.getViewport({scale:Math.min(2, 2400 / Math.max(base.width, base.height))});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await sheet.render({canvasContext:canvas.getContext('2d'), viewport, background:'white'}).promise;
    const rendered = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!rendered) throw Error('该页无法转成图片。');
    return {width:canvas.width, height:canvas.height, file:new File([rendered], '底图-' + page + '.jpg', {type:'image/jpeg'})};
  } finally { await task.destroy(); }
}

export function createPlanUnderlay({project, option, ensure, mutate, upload, render, toast}) {
  let mode = '', points = [], context = '', busy = false;
  const key = () => project()?.id + '/' + option()?.id;
  function cancel() { mode = ''; points = []; }
  function sync() { if (context !== key()) { cancel(); context = key(); } }
  function panel() {
    sync();
    const u = option()?.plan?.underlay;
    return `<div class="studio-underlay-panel"><p>选一份项目图片或 PDF 页作为底图。先定标，再沿图描绘。</p>
      <button type="button" data-action="studio-upload">上传材料</button>
      <form id="studio-underlay-import"><label>底图材料<select name="fileId" required>
      ${project().files.filter(f => ['jpg','png','pdf'].includes(f.type)).map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label>
      <label>PDF 页码<input name="page" type="number" min="1" max="2000" value="1" required></label>
      <button type="submit" ${busy?'disabled':''}>${busy?'正在准备底图…':'设为底图'}</button></form>
      ${u ? `<p>来源 ${esc(project().files.find(f => f.id === u.sourceFileId)?.name)} · 第 ${u.page} 页</p>
      <a href="/api/files/${u.sourceFileId}?preview=1" target="_blank" rel="noopener">查看原件</a>
      <p>${mode==='calibrate'?'在底图上点两个已知距离的位置，已选 '+points.length+' 点':mode==='move'?'在画布拖动底图，松开后保存位置':'底图已'+(u.locked?'锁定':'解锁')}</p>
      <button type="button" data-action="studio-underlay-calibrate">两点定标</button>
      <button type="button" data-action="studio-underlay-move" ${u.locked?'disabled':''}>移动底图</button>
      <button type="button" data-action="studio-underlay-cancel">完成 / 取消操作</button>
      ${points.length===2?'<form id="studio-underlay-scale"><label>两点实际距离 / m<input name="meters" type="number" min="0.001" max="10000" step="any" required></label><button type="submit">应用比例并锁定</button></form>':''}
      <form id="studio-underlay-properties"><label>透明度<input name="opacity" type="number" min="0" max="1" step="0.05" value="${u.opacity}" required></label>
      <label>旋转角度<input name="rotation" type="number" min="-180" max="180" step="any" value="${u.rotation}" required></label>
      <label><input name="locked" type="checkbox" ${u.locked?'checked':''}>锁定底图位置</label><button type="submit">应用</button></form>
      <button type="button" data-action="studio-underlay-remove">移除底图</button>` : ''}</div>`;
  }
  async function action(name) {
    if (!name.startsWith('studio-underlay-')) return false;
    sync();
    if (name === 'studio-underlay-remove') { cancel(); await mutate([{type:'remove_underlay'}], '移除底图'); }
    else if (name === 'studio-underlay-cancel') { cancel(); render(); }
    else { mode = name === 'studio-underlay-calibrate' ? 'calibrate' : 'move'; points = []; render(); }
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('studio-underlay-')) return false;
    sync();
    const data = new FormData(form), u = option()?.plan?.underlay;
    if (form.id === 'studio-underlay-import') {
      if (busy) return true;
      await ensure(); context = key(); const target = context;
      const file = project().files.find(f => f.id === data.get('fileId'));
      if (!file) throw Error('请先上传并选择底图材料。');
      const page = file.type === 'pdf' ? Number(data.get('page')) : 1;
      if (!Number.isInteger(page) || page < 1 || page > 2000) throw Error('请填写有效页码。');
      busy = true; cancel(); render();
      try {
        const image = await drawingImage(file, page);
        if (key() !== target) throw Error('方案已切换，请在原方案重新设置底图。');
        const stored = image.file ? await upload(image.file,{parentId:file.id,page}) : file;
        if (key() !== target) throw Error('方案已切换，底图图片已保存在原项目材料中。');
        await mutate([{type:'set_underlay', underlay:{fileId:stored.id, sourceFileId:file.id, page,
          width:image.width, height:image.height, x:0, y:0, scale:option().plan.width/image.width,
          rotation:0, opacity:.5, locked:true}}], '设置底图');
      } finally { busy = false; render(); }
    } else if (form.id === 'studio-underlay-scale') {
      if (!u || points.length !== 2) throw Error('请重新选择两个定标点。');
      const calibrated = calibrateUnderlay(u, points[0], points[1], Number(data.get('meters')));
      await mutate([{type:'set_underlay',underlay:{...calibrated,locked:true}}], '底图定标');
      cancel(); render();
    } else if (u) {
      await mutate([{type:'set_underlay',underlay:{...u,opacity:Number(data.get('opacity')),
        rotation:Number(data.get('rotation')),locked:data.has('locked')}}], '调整底图');
      cancel(); render();
    }
    return true;
  }
  function mount(svg) {
    sync();
    if (!svg || !mode || !option()?.plan?.underlay) return () => {};
    const u = option().plan.underlay, target = key();
    let drag = null;
    const point = event => { const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse()); return [p.x,p.y]; };
    function marker(p) {
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      circle.setAttribute('cx',p[0]); circle.setAttribute('cy',p[1]); circle.setAttribute('r','.2');
      circle.setAttribute('fill','#c44'); circle.setAttribute('pointer-events','none'); svg.append(circle);
    }
    points.forEach(marker);
    function down(event) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (mode === 'calibrate') {
        if (points.length === 2) points = [];
        points.push(point(event)); render();
      } else if (!u.locked) {
        drag = {pointerId:event.pointerId,start:point(event)};
        svg.dataset.gestureRoute = location.hash; svg.setPointerCapture(event.pointerId);
      }
    }
    function move(event) {
      event.stopImmediatePropagation();
      if (!drag || event.pointerId !== drag.pointerId) return;
      const p = point(event);
      svg.querySelector('.plan-underlay')?.setAttribute('transform', `translate(${u.x+p[0]-drag.start[0]} ${u.y+p[1]-drag.start[1]}) rotate(${u.rotation}) scale(${u.scale})`);
    }
    function finish(event) {
      event.stopImmediatePropagation();
      if (!drag || drag.pointerId !== event.pointerId) return;
      const start = drag.start; drag = null;
      delete svg.dataset.gestureRoute;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      if (event.type !== 'pointerup' || key() !== target) { render(); return; }
      const p = point(event);
      mutate([{type:'set_underlay',underlay:{...u,x:u.x+p[0]-start[0],y:u.y+p[1]-start[1]}}], '移动底图').catch(error => {toast(error.message);render();});
    }
    function escape(event) { if (event.key === 'Escape') { drag=null; cancel(); render(); } }
    svg.addEventListener('pointerdown',down,true); svg.addEventListener('pointermove',move,true);
    for (const name of ['pointerup','pointercancel','lostpointercapture']) svg.addEventListener(name,finish,true);
    document.addEventListener('keydown',escape);
    return () => {
      svg.removeEventListener('pointerdown',down,true); svg.removeEventListener('pointermove',move,true);
      for (const name of ['pointerup','pointercancel','lostpointercapture']) svg.removeEventListener(name,finish,true);
      document.removeEventListener('keydown',escape); drag = null;
    };
  }
  return {panel,action,submit,mount,cancel};
}
