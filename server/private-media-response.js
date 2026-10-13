const variants = new Set(['thumb', 'display']);

export function privateMediaKeys(key) {
  return [key, privatePreviewKey(key, 'thumb'), privatePreviewKey(key, 'display')];
}

export function privatePreviewKey(key, variant) {
  return `${key}.preview-v1-${variant}.webp`;
}

function byteRange(value, size) {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !size) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return {offset: start, length: end - start + 1, end};
}

function notModified(value, etag) {
  return !!etag && value !== null && value.split(',').some(candidate => {
    const tag = candidate.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag.replace(/^W\//, '');
  });
}

function missing() {
  throw Object.assign(new Error('照片或视频暂时不可用，请重试'), {status: 404});
}

// Call only after the current identity and media record have been authorized.
// Browser revalidation always returns through those checks; no shared cache stores bytes.
export async function privateMediaResponse(request, bucket, file) {
  const variant = new URL(request.url).searchParams.get('variant');
  if (variant !== null && !variants.has(variant)) {
    throw Object.assign(new Error('照片尺寸不正确'), {status: 400});
  }
  const preview = !!variant && file.type.startsWith('image/');
  let key = preview ? privatePreviewKey(file.key, variant) : file.key;
  let type = preview ? 'image/webp' : file.type;
  const load = async method => {
    let object = await bucket[method](key);
    if (!object && key !== file.key) {
      key = file.key; type = file.type;
      object = await bucket[method](key);
    }
    if (!object) missing();
    return object;
  };
  const conditional = preview ? request.headers.get('if-none-match') : null;
  const needsMetadata = request.method === 'HEAD' || request.headers.has('range') || conditional !== null;
  // An ordinary photo GET needs one object request rather than HEAD followed by GET.
  const metadata = await load(needsMetadata ? 'head' : 'get');
  const headers = {
    'Content-Type': type,
    'Cache-Control': preview ? 'private, no-cache, must-revalidate' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; media-src 'self'; sandbox",
    'Accept-Ranges': 'bytes',
    'Content-Length': String(metadata.size),
    'Vary': 'Cookie'
  };
  const etag = metadata.httpEtag || (metadata.etag ? `"${metadata.etag}"` : null);
  if (preview && etag) headers.ETag = etag;
  if (preview && notModified(conditional, etag)) {
    delete headers['Content-Length'];
    return new Response(null, {status: 304, headers});
  }
  const range = request.method === 'HEAD' ? null : byteRange(request.headers.get('range'), metadata.size);
  if (range === false) {
    return new Response(null, {status: 416, headers: {...headers, 'Content-Range': `bytes */${metadata.size}`, 'Content-Length': '0'}});
  }
  if (range) {
    headers['Content-Range'] = `bytes ${range.offset}-${range.end}/${metadata.size}`;
    headers['Content-Length'] = String(range.length);
  }
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, {status, headers});
  const object = needsMetadata
    ? await bucket.get(key, range ? {range: {offset: range.offset, length: range.length}} : undefined)
    : metadata;
  if (!object) missing();
  return new Response(object.body, {status, headers});
}
