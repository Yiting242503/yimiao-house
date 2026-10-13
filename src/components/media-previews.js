const tasks = [];
let processing = false;
const variants = [
  { name: 'thumb', width: 640, quality: 0.74, maxBytes: 256 * 1024 },
  { name: 'display', width: 1280, quality: 0.8, maxBytes: 1024 * 1024 }
];

async function uploadPreviews(file, id) {
  const bitmap = await createImageBitmap(file);
  try {
    for (const variant of variants) {
      const factor = Math.min(1, variant.width / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * factor));
      canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob;
      for (const quality of [variant.quality, 0.55, 0.4]) {
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || blob.size <= variant.maxBytes) break;
      }
      canvas.width = canvas.height = 1;
      if (!blob || blob.type !== 'image/webp' || blob.size > variant.maxBytes) continue;
      const response = await fetch(`/api/media/${encodeURIComponent(id)}/preview/${variant.name}`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'image/webp', 'X-House-Request': '1' },
        body: blob, signal: AbortSignal.timeout(20000)
      });
      // Original uploads remain usable even if the optional preview cannot be stored.
      if (!response.ok) return;
    }
  } finally { bitmap.close(); }
}

async function drain() {
  if (processing) return;
  processing = true;
  try {
    while (tasks.length) {
      const task = tasks.shift();
      try { await uploadPreviews(task.file, task.id); } catch { /* Read routes fall back to the original. */ }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { processing = false; }
}

export function preparePhotoPreviews(file, id) {
  if (!file?.type?.startsWith('image/') || !id) return;
  tasks.push({ file, id });
  // One decoder/uploader at a time; writing the memory does not wait for these copies.
  void drain();
}
