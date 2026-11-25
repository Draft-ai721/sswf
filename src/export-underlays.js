// Capture only the images referenced by this fixed report before downloading it.
export async function embeddedUnderlays(project, fileUrl = id => '/api/files/' + id + '?preview=1') {
  const ids = [...new Set((project.workflow?.options || []).map(o => o.plan?.underlay?.fileId).filter(Boolean))];
  const images = new Map();
  for (const id of ids) {
    const response = await fetch(fileUrl(id));
    if (!response.ok) throw Error('底图读取失败，请恢复连接后重新导出。');
    const blob = await response.blob();
    if (!['image/png','image/jpeg'].includes(blob.type)) throw Error('底图图片格式无效。');
    const data = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('底图无法嵌入报告。'));
      reader.readAsDataURL(blob);
    });
    images.set(id,data);
  }
  return id => images.get(id) || fileUrl(id);
}
