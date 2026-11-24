import {areaOf, boundsOf, edgeDistance, footprintOf, interiorPointOf, isPolygon, outsidePlan, overlapsSpace, round, validateVertices} from './plan-geometry.js';
export {areaOf, edgeDistance, round};
import {validateStrokes} from './plan-geometry.js';

export const PLAN_COLORS = ['#c6d8bc','#c9dce4','#e6d8b7','#dacbe0','#bcd9d1','#e6c8b9'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const emptyPlan = () => ({width:30, depth:20, spaces:[]});
export const planOf = option => option?.plan || emptyPlan();

function closestPair(spaces, rule) {
  let distance = Infinity, pair = null;
  for (const a of spaces.filter(s => s.programId === rule.fromId)) {
    for (const b of spaces.filter(s => s.programId === rule.toId)) {
      const gap = edgeDistance(a,b);
      if (gap < distance) {
        distance = gap;
        pair = {a,b,distance};
      }
    }
  }
  return pair;
}

export function planMetrics(plan, program = [], relationships = []) {
  const overlaps = [], outside = [], counts = new Map(), areas = new Map();
  let area = 0;
  for (let i = 0; i < plan.spaces.length; i++) {
    const a = plan.spaces[i], spaceArea = areaOf(a);
    area += spaceArea;
    counts.set(a.programId, (counts.get(a.programId) || 0) + 1);
    areas.set(a.programId, (areas.get(a.programId) || 0) + spaceArea);
    if (outsidePlan(a, plan)) outside.push(a.id);
    for (let j = i+1; j < plan.spaces.length; j++) {
      const b = plan.spaces[j];
      if (overlapsSpace(a,b)) overlaps.push([a.id,b.id]);
    }
  }
  const requirements = program.map(p => ({
    id:p.id, name:p.name, required:p.count, placed:counts.get(p.id)||0,
    targetArea:round(p.count*p.area), actualArea:round(areas.get(p.id)||0),
    missing:Math.max(0,p.count-(counts.get(p.id)||0))
  }));
  const rules = relationships.map(rule => {
    const distance = closestPair(plan.spaces, rule)?.distance ?? null;
    return {...rule, actualDistance:distance, passed:distance===null ? null :
      rule.kind==='相邻' ? distance<=rule.distance : distance>=rule.distance};
  });
  return {area:round(area), canvasArea:round(plan.width*plan.depth), placed:plan.spaces.length,
    missing:requirements.reduce((n,r) => n+r.missing,0),
    excess:requirements.reduce((n,r) => n+Math.max(0,r.placed-r.required),0),
    overlaps, outside, requirements, rules};
}

const validNumber = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const rectFields = ['x','y','width','depth'];
function validateFootprint(space) {
  if ('geometry' in space) {
    if (!isPolygon(space) || rectFields.some(key => key in space)) throw Error('空间只能使用一种轮廓格式。');
    return {geometry:{kind:'polygon', vertices:validateVertices(space.geometry.vertices)}};
  }
  if (!validNumber(space.x,0,1000) || !validNumber(space.y,0,1000) ||
      !validNumber(space.width,.5,1000) || !validNumber(space.depth,.5,1000)) throw Error('空间尺寸无效。');
  return Object.fromEntries(rectFields.map(key => [key,round(space[key])]));
}

export function validatePlan(value, program, {maxSpaces=80, bounded=false} = {}) {
  if (!value || !validNumber(value.width,1,1000) || !validNumber(value.depth,1,1000) ||
      !Array.isArray(value.spaces) || value.spaces.length > maxSpaces) throw Error('空间推演数据无效。');
  const ids = new Set(), programIds = new Set(program.map(p => p.id));
  const spaces = Array.from(value.spaces, space => {
    if (!space || typeof space.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(space.id) ||
        ids.has(space.id) || !programIds.has(space.programId) || !validNumber(space.height,1,30)) {
      throw Error('空间尺寸或功能关联无效。');
    }
    ids.add(space.id);
    const footprint = validateFootprint(space);
    const result = {id:space.id, programId:space.programId, ...footprint, height:round(space.height)};
    if (space.label) result.label = String(space.label).slice(0,80);
    if (bounded && (outsidePlan(space, value) || outsidePlan(result, {width:round(value.width),depth:round(value.depth)}))) {
      throw Error('AI 布局超出了给定画布。');
    }
    return result;
  });
  const strokes=value.strokes===undefined?[]:validateStrokes(value.strokes);
  return {width:round(value.width), depth:round(value.depth), spaces, ...(strokes.length?{strokes}:{})};
}

function spaceSvg(space, program, bad, font, {interactive, selected, resizable}) {
  const index = program.findIndex(p => p.id === space.programId);
  const label = space.label || program[index]?.name || '空间';
  const polygon = isPolygon(space);
  const {x,y,width,depth} = boundsOf(space);
  const [centerX,centerY] = interiorPointOf(space), labelX = centerX-x, labelY = centerY-y;
  const area = round(areaOf(space));
  const fill = PLAN_COLORS[Math.max(0,index) % PLAN_COLORS.length];
  const stroke = bad.has(space.id) ? '#bf6751' : selected ? '#365f7e' : '#758c6b';
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${selected ? .16 : .08}"`;
  const points = polygon ? footprintOf(space).map(([vx,vy]) => [round(vx-x),round(vy-y)]) : [];
  const shape = polygon ? `<polygon points="${points.map(p => p.join(',')).join(' ')}" ${paint}/>` :
    `<rect width="${width}" height="${depth}" rx=".12" ${paint}/>`;
  const controls = !interactive || !resizable || !selected ? '' : polygon ? points.map(([vx,vy],i) =>
    `<circle class="studio-vertex" data-vertex-index="${i}" cx="${vx}" cy="${vy}" r=".32" fill="#365f7e" stroke="white" stroke-width=".08"/>`).join('') :
    `<rect class="studio-resize-hit" data-resize-space="${space.id}" x="${width-.6}" y="${depth-.6}" width="1.2" height="1.2" fill="transparent"/><circle class="studio-resize-handle" cx="${width}" cy="${depth}" r=".23" fill="#365f7e" stroke="white" stroke-width=".08" pointer-events="none"/>`;
  const description = polygon ? `多边形，${area} 平方米` : `${width}乘${depth}米，可拖动或用方向键移动`;
  const interaction = interactive ? `data-space-id="${esc(space.id)}" tabindex="0" role="button" aria-label="${esc(label)}，${description}"` : '';
  return `<g ${interaction} class="sp-space ${selected?'selected':''}" transform="translate(${x} ${y})">${shape}
    <title>${esc(label)} · ${area} m² · ${space.height} m 高</title>
    <text x="${labelX}" y="${labelY-.2}" text-anchor="middle" font-size="${Math.min(font,width/Math.max(3,Math.min(label.length,12))*.8)}" fill="#2f4538" pointer-events="none">${esc(label.slice(0,12))}</text>
    <text x="${labelX}" y="${labelY+font}" text-anchor="middle" font-size="${Math.min(font*.8,width/9)}" fill="#65745c" pointer-events="none">${area} m²</text>${controls}</g>`;
}

export function planSvg(plan, program = [], {interactive=false, selected='', selectedStroke='', scope='plan', relationships=[], showLinks=true, resizable=false} = {}) {
  const metrics = planMetrics(plan), bad = new Set([...metrics.outside,...metrics.overlaps.flat()]);
  const font = Math.max(.45,Math.min(1,plan.width/55)), pad = 1.8;
  const links = showLinks ? relationships.map(rule => {
    const pair = closestPair(plan.spaces,rule);
    if (!pair) return '';
    const [ax,ay] = interiorPointOf(pair.a), [bx,by] = interiorPointOf(pair.b);
    return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${rule.kind==='相邻'?'#4b7666':'#a88957'}" stroke-width=".12" stroke-dasharray=".4 .25"/>`;
  }).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="sp-plan-svg" viewBox="${-pad} ${-pad} ${plan.width+pad*2} ${plan.depth+pad*2}" role="img" aria-label="空间概念布局，${plan.width}米乘${plan.depth}米" ${interactive?'data-plan-canvas="1"':''}>
    <defs><pattern id="grid-${esc(scope)}" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#dce3d8" stroke-width=".025"/></pattern></defs>
    <rect width="${plan.width}" height="${plan.depth}" fill="#f9faf5" stroke="#97aa8d" stroke-width=".08"/>
    <rect width="${plan.width}" height="${plan.depth}" fill="url(#grid-${esc(scope)})"/>
    <text x="${plan.width/2}" y="-.5" text-anchor="middle" font-size="${font}" fill="#788470">${plan.width} m</text>
    <text x="-.6" y="${plan.depth/2}" transform="rotate(-90 -.6 ${plan.depth/2})" text-anchor="middle" font-size="${font}" fill="#788470">${plan.depth} m</text>
    ${plan.spaces.map(s => spaceSvg(s,program,bad,font,{interactive,selected:selected===s.id,resizable})).join('')}
    <g pointer-events="none">${links}</g>
    <g class="plan-ink" pointer-events="none" fill="none" stroke="#385d82" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${(plan.strokes||[]).map((stroke,index)=>{
      const points=esc(stroke.points.map(p=>p.join(',')).join(' '));
      const active=selectedStroke===stroke.id;
      const attributes=interactive?`data-stroke-id="${esc(stroke.id)}" tabindex="0" role="button" aria-label="手绘线 ${index+1}" aria-pressed="${active}"`:'';
      return `<g ${attributes} class="plan-stroke${active?' selected':''}">
        <polyline class="stroke-line" vector-effect="non-scaling-stroke" points="${points}" ${active?'stroke="#b5622d" stroke-width="3.5"':''}/>
        ${interactive?`<polyline class="stroke-hit" vector-effect="non-scaling-stroke" points="${points}" stroke="transparent" stroke-width="16" pointer-events="stroke"/>`:''}
      </g>`;
    }).join('')}</g></svg>`;
}

export const AXON_HEIGHT_SCALE = 12;
export function axonProjection(camera={}) {
  const yaw=camera.yaw??Math.PI/4, pitch=camera.pitch??Math.PI/6;
  return (x,y,z=0)=>[400+Math.SQRT2*9*(x*Math.cos(yaw)-y*Math.sin(yaw)),
    80+Math.SQRT2*9*Math.sin(pitch)*(x*Math.sin(yaw)+y*Math.cos(yaw))-z*axonHeightScale(camera)];
}
export function axonHeightScale(camera={}) {return AXON_HEIGHT_SCALE*Math.cos(camera.pitch??Math.PI/6)/Math.cos(Math.PI/6)}
const project=axonProjection();
const pol = points => points.map(p => project(...p).map(round).join(',')).join(' ');

export function axonFaces(space, program, {interactive=false, selected='',camera}={}) {
  const project=axonProjection(camera),pol=points=>points.map(p=>project(...p).map(round).join(',')).join(' ');
  const points = footprintOf(space);
  const index = program.findIndex(p=>p.id===space.programId);
  const color = PLAN_COLORS[Math.max(0,index)%PLAN_COLORS.length], h = space.height;
  const label = esc(space.label||program[index]?.name||'空间');
  const winding = points.reduce((sum,[x,y],i)=>{
    const [nx,ny]=points[(i+1)%points.length];
    return sum+x*ny-y*nx;
  },0);
  const boundary=winding<0?[...points].reverse():points;
  const sides=boundary.map((a,i)=>[a,boundary[(i+1)%boundary.length]])
    .filter(([a,b])=>project(...b)[0]<project(...a)[0])
    .map(([a,b])=>`<polygon points="${pol([a,b,[...b,h],[...a,h]])}" fill="${color}" opacity="${b[1]>a[1]?'.65':'1'}"/>`).join('');
  const handle=interactive?`data-roof="${esc(space.id)}" tabindex="0" role="slider" aria-label="${label}高度（米）" aria-valuemin="1" aria-valuemax="30" aria-valuenow="${h}"`:'';
  const [cx,cy]=project(...interiorPointOf(space),h);
  const active=interactive&&selected===space.id;
  return `${sides}<polygon points="${pol(boundary.map(p=>[...p,h]))}" fill="${color}" ${handle} ${active?'stroke="#365f7e" stroke-width="1.6"':''}/>
    ${active?`<text x="${cx}" y="${cy}" text-anchor="middle" pointer-events="none" fill="#254537" stroke="none" font-size="8">${h} m</text>`:''}
    <title>${label} · 高 ${h} m</title>`;
}

export function axonSvg(plan, program = [], options={}) {
  const project=axonProjection(options.camera),pol=points=>points.map(p=>project(...p).map(round).join(',')).join(' ');
  const yaw=options.camera?.yaw??Math.PI/4;
  const ground = [[0,0],[plan.width,0],[plan.width,plan.depth],[0,plan.depth]];
  const solids = plan.spaces.map(space => {
    const points = footprintOf(space);
    const bounds = boundsOf(space);
    return {space, points, order:(bounds.x+bounds.width/2)*Math.sin(yaw)+(bounds.y+bounds.depth/2)*Math.cos(yaw)};
  }).sort((a,b) => a.order-b.order);
  const all = ground.map(p => project(...p));
  for (const {space,points} of solids) {
    for (const p of points) all.push(project(...p),project(...p,space.height));
  }
  const minX = Math.min(...all.map(p=>p[0]))-35, minY = Math.min(...all.map(p=>p[1]))-35;
  const width = Math.max(...all.map(p=>p[0]))-minX+35, height = Math.max(...all.map(p=>p[1]))-minY+50;
  const shapes = solids.map(({space})=>
    `<g stroke="#7c8f72" stroke-width=".6" ${options.interactive?`data-solid="${esc(space.id)}"`:''}>${axonFaces(space,program,options)}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="sp-plan-svg" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="空间概念体块预览"><polygon points="${pol(ground)}" fill="#edf1e7" stroke="#bac9ae"/>${shapes}</svg>`;
}
