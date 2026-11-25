export const REQUIREMENT_HEADER = 'X-Plan-Requirements';

export function requirementAreas(row) {
  const spec = row.spec;
  const areaBasis = spec?.areaBasis || 'each';
  const area = spec ? spec.statedAreaM2 : row.area;
  return {
    areaBasis,
    totalM2: area == null ? null : areaBasis === 'total' ? area : area * row.count,
    referenceEachM2: area == null ? null : areaBasis === 'total' ? area / row.count : area,
    confirmed: spec ? spec.confirmation === 'confirmed' : row.origin !== 'sketch' && row.origin !== 'estimate'
  };
}

export function validateRequirementSpec(spec, files) {
  const invalid = () => { throw Error('请核对需求的面积口径、原件、页码和原句。'); };
  if (!spec || !['each','total'].includes(spec.areaBasis) || !['draft','confirmed'].includes(spec.confirmation) ||
      (spec.statedAreaM2 !== null && (!Number.isFinite(spec.statedAreaM2) || spec.statedAreaM2 < 0 || spec.statedAreaM2 > 1e6))) invalid();
  const result = {areaBasis:spec.areaBasis,statedAreaM2:spec.statedAreaM2,confirmation:spec.confirmation};
  if (spec.source === undefined) return result;
  const {fileId,page,quote,region} = spec.source || {};
  const file = files.find(f => f.id === fileId);
  if (!file || !['pdf','png','jpg'].includes(file.type) || typeof quote !== 'string' ||
      !quote.trim() || quote.length > 1600 ||
      (file.type === 'pdf' ? !Number.isInteger(page) || page < 1 || page > 2000 : page !== undefined)) invalid();
  result.source = {fileId, ...(page ? {page} : {}), quote:quote.trim()};
  if (region !== undefined) {
    const {x,y,width,height} = region || {};
    if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 ||
        width <= 0 || height <= 0 || x + width > 1 || y + height > 1) invalid();
    result.source.region = {x,y,width,height};
  }
  return result;
}

const chinese = '零一二三四五六七八九';
function quantity(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (text === '两') return 2;
  if (text.includes('十')) {
    const [tens,units] = text.split('十');
    return (tens ? chinese.indexOf(tens) : 1) * 10 + (units ? chinese.indexOf(units) : 0);
  }
  return chinese.indexOf(text);
}

// Only propose numbers with an explicit area basis. The student reviews every import.
export function requirementCandidates(text) {
  const chineseLine = /^(.+?)\s*([1-9]\d{0,3}|[一二两三四五六七八九十]{1,3})\s*(?:间|个|处|座)\s*[，,:：]?\s*(合计|总计|共计?|总面积|单间|每间|每个|各)\s*[：:=约]?\s*(\d+(?:\.\d+)?)\s*(?:㎡|m\s*[²2]|平方米)(?:\s|[，,]|$)/i;
  const englishLine = /^(.+?)\s+([1-9]\d{0,3})\s+(?:rooms?|spaces?|units?)\s*[:,]?\s*(total|each|per room)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:m\s*[²2]|square meters?)(?:\s|[.,]|$)/i;
  return text.split(/[。；;\n]+/).flatMap(line => {
    const quote = line.trim();
    const match = quote.match(chineseLine)||quote.match(englishLine);
    if (!match) return [];
    const [,name,count,basis,area] = match;
    const parsed = quantity(count), value = Number(area);
    if (!name.trim() || parsed < 1 || parsed > 10000 || value > 1e6) return [];
    return [{name:name.trim().slice(0,160),count:parsed,statedAreaM2:value,
      areaBasis:/^(合计|总计|共|总面积|total$)/i.test(basis)?'total':'each',quote:quote.slice(0,1600)}];
  }).slice(0,80);
}
