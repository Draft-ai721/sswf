import {axonSvg,axonFaces,axonHeightScale,round} from '../shared/space-planning.js';
import {MAX_STROKE_POINTS} from '../shared/plan-geometry.js';

const localPoint=(svg,e)=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());

// Saving normally replaces the page DOM. Preserve the pointer target during a gesture.
export function deferCanvasRender(){
  const svg=document.querySelector('svg[data-gesture-route]');
  if(!svg||svg.dataset.gestureRoute!==location.hash)return false;
  svg.dataset.pendingRender='true';
  return true;
}

function releaseGesture(svg,render){
  delete svg.dataset.gestureRoute;
  if(svg.dataset.pendingRender){
    delete svg.dataset.pendingRender;
    queueMicrotask(render);
  }
}

export function mountStrokeSelection(svg,plan,{select,commit,render}){
  let drag=null;
  const consume=e=>{e.preventDefault();e.stopImmediatePropagation()};
  svg.addEventListener('pointerdown',e=>{
    const group=e.target.closest('[data-stroke-id]');
    if(!group||drag||e.button!==0||!e.isPrimary)return;
    const stroke=plan.strokes?.find(s=>s.id===group.dataset.strokeId);
    if(!stroke)return;
    consume(e);
    select(stroke.id);
    drag={pointerId:e.pointerId,stroke,group,start:localPoint(svg,e),clientX:e.clientX,clientY:e.clientY,dx:0,dy:0};
    svg.dataset.gestureRoute=location.hash;
    svg.setPointerCapture(e.pointerId);
  });
  function move(e){
    const point=localPoint(svg,e);
    const xs=drag.stroke.points.map(([x])=>x),ys=drag.stroke.points.map(([,y])=>y);
    drag.dx=round(Math.max(-Math.min(...xs),Math.min(plan.width-Math.max(...xs),point.x-drag.start.x)));
    drag.dy=round(Math.max(-Math.min(...ys),Math.min(plan.depth-Math.max(...ys),point.y-drag.start.y)));
    drag.group.setAttribute('transform',`translate(${drag.dx} ${drag.dy})`);
  }
  svg.addEventListener('pointermove',e=>{
    if(drag?.pointerId!==e.pointerId)return;
    consume(e);
    if(Math.hypot(e.clientX-drag.clientX,e.clientY-drag.clientY)>3||drag.moved){
      drag.moved=true;
      move(e);
    }
  });
  svg.addEventListener('pointerup',e=>{
    if(drag?.pointerId!==e.pointerId)return;
    consume(e);
    if(drag.moved)move(e);
    const finished=drag;
    drag=null;
    releaseGesture(svg,render);
    if(finished.dx||finished.dy)commit(finished.stroke.id,finished.dx,finished.dy);
    else render();
  });
  function cancel(e){
    if(drag?.pointerId!==e.pointerId)return;
    consume(e);
    drag=null;
    releaseGesture(svg,render);
    render();
  }
  svg.addEventListener('pointercancel',cancel);
  svg.addEventListener('lostpointercapture',cancel);
}

export function mountPen(svg,plan,commit,render){
  let stroke=null;
  function sample(e){
    const at=localPoint(svg,e);
    const point=[round(Math.max(0,Math.min(plan.width,at.x))),round(Math.max(0,Math.min(plan.depth,at.y)))];
    const last=stroke.points.at(-1);
    if(last&&point[0]===last[0]&&point[1]===last[1])return;
    if(stroke.points.length>=MAX_STROKE_POINTS)stroke.points=stroke.points.filter((_,i)=>i%2===0);
    stroke.points.push(point);
  }
  function cancel(){
    stroke?.line.remove();
    stroke=null;
    releaseGesture(svg,render);
  }
  svg.addEventListener('pointerdown',e=>{
    if(stroke||e.button!==0||!e.isPrimary)return;
    const at=localPoint(svg,e);
    if(at.x<0||at.y<0||at.x>plan.width||at.y>plan.depth)return;
    e.preventDefault();
    const line=document.createElementNS(svg.namespaceURI,'polyline');
    line.setAttribute('vector-effect','non-scaling-stroke');
    svg.querySelector('.plan-ink').append(line);
    stroke={id:e.pointerId,line,points:[]};
    svg.dataset.gestureRoute=location.hash;
    sample(e);
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove',e=>{
    if(stroke?.id!==e.pointerId)return;
    for(const event of e.getCoalescedEvents?.()||[])sample(event);
    sample(e);
    stroke.line.setAttribute('points',stroke.points.map(p=>p.join(',')).join(' '));
  });
  svg.addEventListener('pointerup',e=>{
    if(stroke?.id!==e.pointerId)return;
    sample(e);
    const {points,line}=stroke;
    if(points.length<2){cancel();return}
    stroke=null;
    line.setAttribute('points',points.map(p=>p.join(',')).join(' '));
    commit(points);
    releaseGesture(svg,render);
  });
  svg.addEventListener('lostpointercapture',e=>{if(stroke?.id===e.pointerId)cancel()});
  svg.addEventListener('pointercancel',e=>{if(stroke?.id===e.pointerId)cancel()});
  return cancel;
}

export function mountExtrusion(svg,plan,program,{select,commit,render,camera}){
  let drag=null;
  const heightAt=e=>Math.max(1,Math.min(30,Math.round((drag.space.height+(drag.startY-localPoint(svg,e).y)/axonHeightScale(camera))*10)/10));
  svg.addEventListener('pointerdown',e=>{
    const roof=e.target.closest('[data-roof]');
    if(!roof||drag||e.button!==0||!e.isPrimary)return;
    const space=plan.spaces.find(s=>s.id===roof.dataset.roof);
    if(!space)return;
    e.preventDefault();
    select(space.id);
    drag={id:e.pointerId,space,group:roof.parentNode,startY:localPoint(svg,e).y,clientY:e.clientY};
    svg.dataset.gestureRoute=location.hash;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove',e=>{
    if(drag?.id!==e.pointerId||Math.abs(e.clientY-drag.clientY)<2&&!drag.moved)return;
    drag.moved=true;
    drag.group.innerHTML=axonFaces({...drag.space,height:heightAt(e)},program,{interactive:true,selected:drag.space.id,camera});
  });
  svg.addEventListener('pointerup',e=>{
    if(drag?.id!==e.pointerId)return;
    const space=drag.space;
    const height=drag.moved||Math.abs(e.clientY-drag.clientY)>=2?heightAt(e):space.height;
    drag=null;
    releaseGesture(svg,render);
    if(height!==space.height)commit(space.id,height);
    else render();
  });
  function cancel(e){
    if(drag?.id===e.pointerId){drag=null;releaseGesture(svg,render);render()}
  }
  svg.addEventListener('pointercancel',cancel);
  svg.addEventListener('lostpointercapture',cancel);
  svg.addEventListener('keydown',e=>{
    if(!['ArrowUp','ArrowDown'].includes(e.key)||!e.target.dataset.roof)return;
    e.preventDefault();e.stopPropagation();
    const space=plan.spaces.find(s=>s.id===e.target.dataset.roof);
    const height=round(Math.min(30,Math.max(1,space.height+(e.key==='ArrowUp'?.1:-.1))));
    select(space.id);
    Promise.resolve(commit(space.id,height)).then(()=>document.querySelector('[data-roof="'+space.id+'"]')?.focus());
  });
}

export function mountMassOrbit(svg,plan,program,camera,selection,render) {
  let drag=null;
  function paint(){
    const template=new DOMParser().parseFromString(axonSvg(plan,program,{interactive:true,selected:selection(),camera}),'image/svg+xml').documentElement;
    const [x,y,w,h]=template.getAttribute('viewBox').split(' ').map(Number);
    svg.innerHTML=template.innerHTML;
    svg.setAttribute('viewBox',[x+w*(1-1/camera.zoom)/2+camera.panX,y+h*(1-1/camera.zoom)/2+camera.panY,w/camera.zoom,h/camera.zoom].join(' '));
    svg.dataset.yaw=camera.yaw;svg.dataset.pitch=camera.pitch;svg.dataset.zoom=camera.zoom;
  }
  paint();
  svg.style.touchAction='none';
  svg.addEventListener('contextmenu',e=>e.preventDefault());
  svg.addEventListener('pointerdown',e=>{
    if(drag||!e.isPrimary||![0,1,2].includes(e.button))return;
    if(e.button===0&&!e.shiftKey&&e.target.closest('[data-roof]'))return;
    e.preventDefault();e.stopImmediatePropagation();
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,pan:e.button!==0};
    svg.dataset.gestureRoute=location.hash;svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove',e=>{
    if(drag?.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
    if(drag.pan){const box=svg.viewBox.baseVal;camera.panX-=dx*box.width/svg.clientWidth;camera.panY-=dy*box.height/svg.clientHeight}
    else{camera.yaw+=dx*.012;camera.pitch=Math.max(.12,Math.min(1.4,camera.pitch+dy*.008))}
    paint();
  });
  function finish(e){if(drag?.id!==e.pointerId)return;drag=null;releaseGesture(svg,render)}
  svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);svg.addEventListener('lostpointercapture',finish);
  svg.addEventListener('wheel',e=>{e.preventDefault();if(svg.dataset.gestureRoute)return;camera.zoom=Math.max(.2,Math.min(8,camera.zoom*Math.exp(-e.deltaY*.001)));paint()},{passive:false});
}
