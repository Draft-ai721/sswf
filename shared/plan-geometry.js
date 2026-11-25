export const round = value => Math.round(value * 100) / 100;
export const MAX_VERTICES = 64;
export const PLAN_VIEW_HEADER = 'X-Plan-Views';

export function validateViewpoints(value) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>12)throw Error('每个方案最多保存 12 个视角。');
  const ids=new Set();
  return value.map(item=>{
    if(typeof item?.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(item.id)||ids.has(item.id)||
        typeof item.name!=='string'||!item.name.trim()||item.name.length>60||!['plan','axon'].includes(item.kind)){
      throw Error('视角名称或编号无效。');
    }
    const limits=item.kind==='plan'?{zoom:[.2,6],panX:[-1e6,1e6],panY:[-1e6,1e6]}:
      {zoom:[.2,8],panX:[-1e6,1e6],panY:[-1e6,1e6],yaw:[-Math.PI,Math.PI],pitch:[.12,1.4]};
    const camera=Object.fromEntries(Object.entries(limits).map(([key,[min,max]])=>{
      const number=item.camera?.[key];
      if(!Number.isFinite(number)||number<min||number>max)throw Error('视角参数无效。');
      return [key,number];
    }));
    ids.add(item.id);
    return {id:item.id,name:item.name.trim(),kind:item.kind,camera};
  });
}

export function endpointAtLength(start, direction, meters) {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length === 0 || !Number.isFinite(meters) || meters < .01 || meters > 1500) {
    throw Error('请输入有效的边长和方向。');
  }
  return start.map((value, i) => round(value + direction[i] / length * meters));
}

export function spaceWithEdgeLength(space, edgeIndex, meters) {
  const vertices = footprintOf(space);
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= vertices.length) {
    throw Error('请选择要调整的边。');
  }
  const endIndex = (edgeIndex + 1) % vertices.length;
  const start = vertices[edgeIndex], end = vertices[endIndex];
  const next = endpointAtLength(start, end.map((value, i) => value - start[i]), meters);
  if (!isPolygon(space)) {
    if (meters < .5 || meters > 1000) throw Error('矩形边长应在 0.5 至 1000 米之间。');
    return {...space, [edgeIndex % 2 ? 'depth' : 'width']:round(meters)};
  }
  return {...space, geometry:{kind:'polygon',vertices:validateVertices(vertices.map((point,i) => i === endIndex ? next : point))}};
}

export function snapPlanPoint(raw, {outlines, previous, radius, enabled = true}) {
  const distance = point => Math.hypot(raw[0]-point[0], raw[1]-point[1]);
  const nearest = points => {
    let best, bestDistance = Infinity;
    for (const point of points) {
      const d = distance(point);
      if (d <= radius && d < bestDistance) { best = point; bestDistance = d; }
    }
    return best;
  };
  if (enabled) {
    const vertices = nearest(outlines.flatMap(({points, excluded}) => points.filter((_,i) => i !== excluded)));
    if (vertices) return {point:vertices,kind:'端点'};
    const midpoints = nearest(outlines.flatMap(({points, closed, excluded}) => points.flatMap(([x,y], i) => {
      const next = i + 1 < points.length ? i + 1 : closed ? 0 : -1;
      if (next === -1 || next === i || i === excluded || next === excluded) return [];
      return [[round((x + points[next][0])/2),round((y + points[next][1])/2)]];
    })));
    if (midpoints) return {point:midpoints,kind:'中点'};
    if (previous) {
      const orthogonal = nearest([[raw[0],previous[1]],[previous[0],raw[1]]]);
      if (orthogonal) return {point:orthogonal.map(round),kind:'正交'};
    }
    return {point:raw.map(value => Math.round(value*2)/2),kind:''};
  }
  return {point:raw.map(round),kind:''};
}
export const PLAN_GEOMETRY_VERSION = '3';
export const MAX_STROKE_POINTS = 512;

export function validateStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length > 80) throw Error('一个方案最多保留 80 笔手绘线。');
  const ids = new Set();
  return strokes.map(stroke => {
    if (typeof stroke?.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(stroke.id) || ids.has(stroke.id)) throw Error('手绘线编号无效。');
    ids.add(stroke.id);
    if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > MAX_STROKE_POINTS) throw Error('手绘线点数无效。');
    const points = stroke.points.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(v=>Number.isFinite(v)&&v>=0&&v<=1000)) throw Error('手绘线坐标无效。');
      return point.map(round);
    });
    return {id:stroke.id, points};
  });
}

// Keep the corners furthest from the approximating segments (Douglas-Peucker).
export function outlineFromStroke(points) {
  const path = [...points, points[0]];
  const keep = new Set([0,path.length-1]);
  const ranges = [[0,path.length-1]];
  for (let tolerance=.06; ; tolerance*=2) {
    while (ranges.length) {
      const [start,end] = ranges.pop();
      let split=start, maximum=tolerance;
      const a=path[start], b=path[end];
      for (let i=start+1; i<end; i++) {
        const distance=a[0]===b[0]&&a[1]===b[1] ? Math.hypot(path[i][0]-a[0],path[i][1]-a[1]) : pointEdgeDistance(path[i],[a,b]);
        if (distance>maximum) { maximum=distance; split=i; }
      }
      if (split!==start) { keep.add(split); ranges.push([start,split],[split,end]); }
    }
    if (keep.size-1<=MAX_VERTICES) {
      const vertices=[...keep].sort((a,b)=>a-b).slice(0,-1).map(i=>path[i]);
      return validateVertices(vertices);
    }
    keep.clear(); keep.add(0); keep.add(path.length-1); ranges.push([0,path.length-1]);
  }
}
export const PLAN_GEOMETRY_HEADER = 'X-Plan-Geometry';
export const isPolygon = space => space.geometry?.kind === 'polygon';

const EPSILON = 1e-9;
const RECT_TOLERANCE = .001;
const edgesOf = points => points.map((point, index) => [point, points[(index + 1) % points.length]]);
const cross = ([ax, ay], [bx, by], [cx, cy]) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const signedArea = points => edgesOf(points).reduce((area, [[ax, ay], [bx, by]]) => area + ax * by - ay * bx, 0) / 2;

export function footprintOf(space) {
  if (isPolygon(space)) return space.geometry.vertices;
  const {x, y, width, depth} = space;
  return [[x,y], [x+width,y], [x+width,y+depth], [x,y+depth]];
}

export function boundsOf(space) {
  if (!isPolygon(space)) return {x:space.x, y:space.y, width:space.width, depth:space.depth};
  let x=Infinity, y=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const [vx,vy] of space.geometry.vertices) {
    x=Math.min(x,vx); y=Math.min(y,vy);
    maxX=Math.max(maxX,vx); maxY=Math.max(maxY,vy);
  }
  return {x, y, width:round(maxX-x), depth:round(maxY-y)};
}

export function areaOf(space) {
  return isPolygon(space) ? Math.abs(signedArea(footprintOf(space))) : space.width * space.depth;
}

export function outsidePlan(space, plan) {
  const {x, y, width, depth} = boundsOf(space);
  return x < 0 || y < 0 || x + width > plan.width + RECT_TOLERANCE || y + depth > plan.depth + RECT_TOLERANCE;
}

function onSegment([a, b], point) {
  return Math.abs(cross(a, b, point)) <= EPSILON && point.every((value, i) =>
    value >= Math.min(a[i], b[i]) - EPSILON && value <= Math.max(a[i], b[i]) + EPSILON);
}

function properCrossing([a,b], [c,d]) {
  const ac = cross(a,b,c), ad = cross(a,b,d), ca = cross(c,d,a), cb = cross(c,d,b);
  return ((ac > EPSILON && ad < -EPSILON) || (ad > EPSILON && ac < -EPSILON))
    && ((ca > EPSILON && cb < -EPSILON) || (cb > EPSILON && ca < -EPSILON));
}

function edgesTouch(first, second) {
  return second.some(point => onSegment(first, point)) || first.some(point => onSegment(second, point));
}

export function validateVertices(input) {
  if (!Array.isArray(input) || input.length < 3 || input.length > MAX_VERTICES) {
    throw Error('请用 3 至 64 个顶点闭合多边形。');
  }
  const points = Array.from(input, point => {
    if (!Array.isArray(point) || point.length !== 2 || ![...point].every(value =>
      Number.isFinite(value) && value >= 0 && value <= 2000)) throw Error('多边形顶点坐标无效。');
    return point.map(round);
  });
  if (new Set(points.map(point => point.join(','))).size !== points.length) throw Error('多边形顶点不能重复。');
  const bounds = boundsOf({geometry:{kind:'polygon', vertices:points}});
  if (bounds.x > 1000 || bounds.y > 1000 || bounds.width < .5 || bounds.depth < .5 ||
      bounds.width > 1000 || bounds.depth > 1000 || Math.abs(signedArea(points)) <= EPSILON) {
    throw Error('多边形的面积或外包尺寸无效。');
  }
  const edges = edgesOf(points);
  for (const [i, edge] of edges.entries()) {
    const [a,b] = edge, c = edges[(i + 1) % edges.length][1];
    if (onSegment(edge,c) || onSegment([b,c],a)) throw Error('多边形相邻边不能折返。');
    for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue;
      if (properCrossing(edge, edges[j]) || edgesTouch(edge, edges[j])) throw Error('多边形的边不能交叉或相触。');
    }
  }
  return points;
}

function horizontalIntervals(edges, y) {
  const xs = [];
  for (const [[ax,ay],[bx,by]] of edges) {
    if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
  }
  return xs.sort((a,b) => a-b);
}

function vertexLevels(points) {
  return [...new Set(points.map(([,y]) => y))].sort((a,b) => a-b);
}

export function interiorPointOf(space) {
  const bounds = boundsOf(space);
  let center = [bounds.x+bounds.width/2,bounds.y+bounds.depth/2];
  if (!isPolygon(space)) return center;
  const points = footprintOf(space), levels = vertexLevels(points), edges = edgesOf(points);
  let best = -Infinity;
  for (let k = 1; k < levels.length; k++) {
    const band = levels[k]-levels[k-1], y = levels[k-1]+band/2;
    const xs = horizontalIntervals(edges,y);
    for (let i = 0; i < xs.length; i += 2) {
      const score = (xs[i+1]-xs[i])*band;
      if (score > best) {
        best = score;
        center = [(xs[i]+xs[i+1])/2,y];
      }
    }
  }
  return center;
}

function interiorOverlap(a, b, aEdges, bEdges) {
  // After excluding proper crossings, interval order can change only at vertex heights.
  const levels = vertexLevels([...a, ...b]);
  for (let k = 1; k < levels.length; k++) {
    const y = (levels[k-1] + levels[k]) / 2;
    const as = horizontalIntervals(aEdges, y), bs = horizontalIntervals(bEdges, y);
    for (let i = 0, j = 0; i < as.length && j < bs.length;) {
      if (Math.min(as[i+1], bs[j+1]) - Math.max(as[i], bs[j]) > EPSILON) return true;
      if (as[i+1] < bs[j+1]) i += 2;
      else j += 2;
    }
  }
  return false;
}

export function overlapsSpace(a, b) {
  const ab = boundsOf(a), bb = boundsOf(b), polygon = isPolygon(a) || isPolygon(b);
  const tolerance = polygon ? EPSILON : RECT_TOLERANCE;
  const dx = Math.min(ab.x+ab.width, bb.x+bb.width) - Math.max(ab.x, bb.x);
  const dy = Math.min(ab.y+ab.depth, bb.y+bb.depth) - Math.max(ab.y, bb.y);
  if (dx <= tolerance || dy <= tolerance) return false;
  if (!polygon) return true;
  const av = footprintOf(a), bv = footprintOf(b), ae = edgesOf(av), be = edgesOf(bv);
  return ae.some(edge => be.some(other => properCrossing(edge, other))) || interiorOverlap(av,bv,ae,be);
}

function pointEdgeDistance([x,y], [[ax,ay],[bx,by]]) {
  const dx = bx-ax, dy = by-ay;
  const t = Math.max(0, Math.min(1, ((x-ax)*dx + (y-ay)*dy) / (dx*dx + dy*dy)));
  return Math.hypot(x-ax-t*dx, y-ay-t*dy);
}

export function edgeDistance(a, b) {
  if (!isPolygon(a) && !isPolygon(b)) {
    const dx = Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width);
    const dy = Math.max(0,a.y-b.y-b.depth,b.y-a.y-a.depth);
    return round(Math.hypot(dx,dy));
  }
  if (overlapsSpace(a,b)) return 0;
  let distance = Infinity;
  for (const first of edgesOf(footprintOf(a))) {
    for (const second of edgesOf(footprintOf(b))) {
      if (edgesTouch(first, second)) return 0;
      for (const point of first) distance = Math.min(distance, pointEdgeDistance(point, second));
      for (const point of second) distance = Math.min(distance, pointEdgeDistance(point, first));
    }
  }
  return round(distance);
}

export function atPosition(space, x, y) {
  if (!isPolygon(space)) return {...space, x:round(x), y:round(y)};
  const bounds = boundsOf(space);
  const vertices = footprintOf(space).map(([vx,vy]) => [round(vx-bounds.x+x),round(vy-bounds.y+y)]);
  return {...space, geometry:{kind:'polygon', vertices}};
}
