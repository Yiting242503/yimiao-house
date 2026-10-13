export async function api(path,method='GET',data) {
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-House-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  let value; try { value=await response.json(); } catch { throw new Error('小屋暂时连接不上，请稍后重试'); }
  if(!response.ok) throw Object.assign(new Error(value.error||'没有保存成功，请重试'),{status:response.status});
  return value;
}
export function upload(file,onProgress) {
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();
    request.open('POST','/api/upload'); request.setRequestHeader('X-House-Request','1'); request.withCredentials=true;
    request.upload.onprogress=e=>{ if(e.lengthComputable) onProgress(Math.round(e.loaded/e.total*100)); };
    request.onerror=()=>reject(new Error('上传未完成，附件和文字还在，可以重试'));
    request.onload=()=>{ let data; try { data=JSON.parse(request.responseText); } catch { reject(new Error('上传失败，请重试')); return; } if(request.status>=200&&request.status<300) resolve(data); else reject(new Error(data.error||'上传失败，请重试')); };
    const form=new FormData(); form.append('file',file); request.send(form);
  });
}
export async function optimizePhoto(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 照片');
  if(file.size>20*1024*1024) throw new Error('请选择 20 MB 以内的原图');
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas'); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.88));
  if(!blob) throw new Error('照片处理失败，请重新选择');
  return new File([blob],`${file.name.replace(/\.[^.]+$/,'')}.webp`,{type:'image/webp'});
}
export async function prepareMediaUpload(file) {
  if(file.type==='video/mp4'||(!file.type&&/\.mp4$/i.test(file.name))) {
    if(file.size>50*1024*1024) throw new Error('请选择 50 MB 以内的 MP4 视频');
    return file.type?file:new File([file],file.name,{type:'video/mp4',lastModified:file.lastModified});
  }
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG、WebP 照片或 MP4 视频');
  return optimizePhoto(file);
}
