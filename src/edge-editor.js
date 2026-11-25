import {areaOf,footprintOf,isPolygon,outsidePlan,round,spaceWithEdgeLength} from '../shared/plan-geometry.js';

export function edgeFields(space) {
  const points=footprintOf(space);
  return `<label>边<select name="edgeIndex">${points.map(([x,y],i)=>{
    const [endX,endY]=points[(i+1)%points.length];
    return `<option value="${i}" data-length="${round(Math.hypot(endX-x,endY-y))}">边 ${i+1} · (${x}, ${y}) → (${endX}, ${endY})</option>`;
  }).join('')}</select></label>
  <label>长度 / m<input name="meters" type="number" min="${isPolygon(space)?0.01:0.5}" max="${isPolygon(space)?1500:1000}" step=".01" value="${round(Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]))}" required></label>
  <p>${isPolygon(space)?'固定起点，沿原方向移动终点。':'固定左上角，保留矩形。'}</p><output data-edge-result></output>`;
}

export function mountEdgeEditor(form,space,plan,preview) {
  if(!form||!space)return;
  form.dataset.footprint=JSON.stringify(footprintOf(space));
  const {edgeIndex,meters}=form.elements;
  function update() {
    const output=form.querySelector('[data-edge-result]');
    if(!meters.value){output.textContent='';preview?.(null);return}
    try{
      const edited=spaceWithEdgeLength(space,Number(edgeIndex.value),Number(meters.value));
      if(outsidePlan(edited,plan))throw Error('这条边会超出画布。');
      const points=footprintOf(edited), i=Number(edgeIndex.value), next=points[(i+1)%points.length];
      output.textContent='预览边长 '+round(Math.hypot(next[0]-points[i][0],next[1]-points[i][1]))+' m · '+round(areaOf(edited))+' ㎡';
      preview?.(points,i);
    }catch(error){output.textContent=error.message;preview?.(null)}
  }
  edgeIndex.addEventListener('change',()=>{meters.value=edgeIndex.selectedOptions[0].dataset.length;update()});
  meters.addEventListener('input',update);
}
