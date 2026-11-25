const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function validateUnderlay(value) {
  if (!value || !/^[a-zA-Z0-9-]{1,80}$/.test(value.fileId) ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(value.sourceFileId) ||
      !Number.isInteger(value.page) || value.page < 1 || value.page > 2000 ||
      !finite(value.width, 1, 20000) || !finite(value.height, 1, 20000) ||
      !finite(value.x, -10000, 10000) || !finite(value.y, -10000, 10000) ||
      !finite(value.scale, .000001, 1000) || !finite(value.rotation, -180, 180) ||
      !finite(value.opacity, 0, 1) || typeof value.locked !== 'boolean') {
    throw Error('底图位置、比例或文件信息无效。');
  }
  return Object.fromEntries(['fileId','sourceFileId','page','width','height','x','y','scale','rotation','opacity','locked'].map(key => [key, value[key]]));
}

export function calibrateUnderlay(underlay, first, second, meters) {
  validateUnderlay(underlay);
  if (![...first, ...second, meters].every(Number.isFinite) || meters <= 0 || meters > 10000) {
    throw Error('请输入有效的实际长度。');
  }
  const distance = Math.hypot(second[0] - first[0], second[1] - first[1]);
  if (distance < .01) throw Error('请选择两个不同的位置。');
  const factor = meters / distance;
  return validateUnderlay({...underlay,
    x: first[0] + (underlay.x - first[0]) * factor,
    y: first[1] + (underlay.y - first[1]) * factor,
    scale: underlay.scale * factor
  });
}

export function underlaySvg(underlay, fileUrl) {
  if (!underlay) return '';
  const u = validateUnderlay(underlay);
  const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  return `<g class="plan-underlay" pointer-events="none" opacity="${u.opacity}" transform="translate(${u.x} ${u.y}) rotate(${u.rotation}) scale(${u.scale})"><image href="${escape(fileUrl(u.fileId))}" width="${u.width}" height="${u.height}" preserveAspectRatio="none"/></g>`;
}
