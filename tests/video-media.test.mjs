import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { privateMediaResponse, privateMediaKeys, privatePreviewKey } from '../server/private-media-response.js';

const origin='https://video-house.example';
const memberA='video-site-A', memberB='video-site-B';
const fixture=Buffer.alloc(128);
fixture.writeUInt32BE(24,0);fixture.write('ftyp',4);fixture.write('isom',8);
fixture.write('isom',16);fixture.write('mp42',20);
fixture.writeUInt32BE(104,24);fixture.write('mdat',28);
for(let index=32;index<fixture.length;index++)fixture[index]=index;
const streamFixture=Buffer.from(fixture.subarray(0,80));
streamFixture.writeUInt32BE(56,24);
for(let index=32;index<streamFixture.length;index++)streamFixture[index]=255-index;

test('private stream GET passes the R2 body through without buffering or cache validators',async()=>{
  const key='private/yiting/direct-stream',calls=[];
  const body=new ReadableStream({start(controller){controller.enqueue(streamFixture.subarray(0,32));controller.enqueue(streamFixture.subarray(32));controller.close();}});
  const bucket={async head(){throw new Error('Ordinary stream GET must not request metadata separately');},async get(requested,options){calls.push([requested,options]);return {size:streamFixture.length,httpEtag:'"stream-etag"',body,async arrayBuffer(){throw new Error('Worker must stream the object body');}};}};
  const response=await privateMediaResponse(new Request(origin+'/api/media/video?variant=stream',{headers:{'If-None-Match':'*'}}),bucket,{key,type:'video/mp4'});
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'video/mp4');
  assert.equal(response.headers.get('Content-Length'),String(streamFixture.length));assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('ETag'),null);assert.deepEqual(Buffer.from(await response.arrayBuffer()),streamFixture);
  assert.deepEqual(calls,[[key+'.preview-v1-stream.mp4',undefined]]);
  assert.deepEqual(privateMediaKeys(key),[key,key+'.preview-v1-thumb.webp',key+'.preview-v1-display.webp',key+'.preview-v1-stream.mp4']);
});

test('media variants reject the wrong media kind before reading R2',async()=>{
  const bucket={async head(){throw new Error('Invalid variants must not read storage');},async get(){throw new Error('Invalid variants must not read storage');}};
  for(const [type,query] of [['image/jpeg','variant=stream'],['video/mp4','variant=thumb'],['video/mp4','variant=display'],['video/mp4','variant=unknown'],['video/mp4','variant=stream&variant=stream']]) {
    await assert.rejects(privateMediaResponse(new Request(origin+'/api/media/video?'+query),bucket,{key:'private/yiting/invalid',type}),error=>error.status===400);
  }
});

test('MP4 uploads remain private and support authorized playback and seeking',async t=>{
  const bundled=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const isolatedState=await mkdtemp(resolve('test-results','video-state-'));
  const runtime=new Miniflare(convertV4MiniflareOptions({
    modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',
    d1Databases:{DB:'isolated-video-db'},r2Buckets:{BUCKET:'isolated-video-media'},
    resourcePersistencePath:isolatedState,
bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:memberA,haomiao:memberB})}
  }));
  const request=async(path,{id=memberA,method='GET',data,form,range,headers={}}={})=>{
    const options={
    method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin,...(form?{}:{'Content-Type':'application/json'})}),...(range===undefined?{}:{Range:range}),...headers},
    body:form??(data===undefined?undefined:JSON.stringify(data))
    };
    if(form) {
      const encoded=new Request(origin+'/api'+path,options);
      options.headers=Object.fromEntries(encoded.headers);
      options.body=new Uint8Array(await encoded.arrayBuffer());
    }
    return runtime.dispatchFetch(origin+'/api'+path,options);
  };
  const upload=(bytes=fixture,{id=memberA,type='video/mp4',name='private-video.mp4'}={})=>{
    const form=new FormData();form.append('file',new Blob([bytes],{type}),name);
    return request('/upload',{id,method:'POST',form});
  };
  let video,published,draftVideo,draft;
  try {
    const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
    for(const file of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort()) {
      for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint')) {
        if(statement.trim())await db.prepare(statement).run();
      }
    }
    await t.test('anonymous and unauthorized identities cannot upload or discover private media',async()=>{
      assert.equal((await upload(fixture,{id:null})).status,401);
      assert.equal((await upload(fixture,{id:'video-site-outsider'})).status,403);
      for(const method of ['GET','HEAD']) {
        assert.equal((await request('/media/unknown',{id:null,method,range:'bytes=0-0'})).status,401);
        assert.equal((await request('/media/unknown',{id:'video-site-outsider',method,range:'bytes=0-0'})).status,403);
      }
    });
    await t.test('file signatures reject forged MP4s and preserve the 8 MiB image limit',async()=>{
      assert.equal((await upload(Buffer.from('not a video'),{type:'video/mp4',name:'forged.mp4'})).status,400);
      const invalidSize=Buffer.from(fixture);invalidSize.writeUInt32BE(2048,0);
      assert.equal((await upload(invalidSize)).status,400);
      const unsupportedBrand=Buffer.from(fixture);unsupportedBrand.write('avif',8);
      assert.equal((await upload(unsupportedBrand)).status,400);
      const oversizedPhoto=Buffer.alloc(8*1024*1024+1);oversizedPhoto.set([255,216,255]);
      assert.equal((await upload(oversizedPhoto,{type:'image/jpeg',name:'too-large.jpg'})).status,413);
      const oversizedVideo=Buffer.alloc(50*1024*1024+1);fixture.copy(oversizedVideo);
      assert.equal((await upload(oversizedVideo)).status,413);
      const oversizedRequest=Buffer.alloc(51*1024*1024+1);fixture.copy(oversizedRequest);
      assert.equal((await upload(oversizedRequest)).status,413);
    });
    await t.test('valid MP4 bytes determine type and owner before records are shared',async()=>{
      const response=await upload(fixture,{type:'text/plain',name:'video.data'});
      assert.equal(response.status,200,await response.clone().text());video=await response.json();
      assert.equal(video.type,'video/mp4');
      const metadata=await db.prepare('SELECT owner,type,key FROM media WHERE id=?').bind(video.id).first();
      assert.equal(metadata.owner,'yiting');assert.equal(metadata.type,'video/mp4');
      const stored=await (await runtime.getR2Bucket('BUCKET')).get(metadata.key);
      assert.deepEqual(Buffer.from(await stored.arrayBuffer()),fixture);
      assert.equal((await request('/media/'+video.id,{id:memberB})).status,404);
      const house=await (await request('/house')).json();
      assert.equal((await request('/settings',{method:'PUT',data:{...house.settings,people:{...house.settings.people,yiting:{...house.settings.people.yiting,avatar:video.id}}}})).status,403);
      const saved=await request('/entries',{method:'POST',data:{requestId:'video-test-published',kind:'memory',text:'Isolated video fixture',date:'2026-10-09',meetingId:'initial-2',author:'haomiao',media:[video.id]}});
      assert.equal(saved.status,200,await saved.clone().text());published=await saved.json();
      const otherHouse=await (await request('/house',{id:memberB})).json();
      const entry=otherHouse.entries.find(item=>item.id===published.id);
      assert.equal(entry.author,'yiting');assert.equal(entry.status,'published');assert.equal(entry.media[0].type,'video/mp4');
    });
    await t.test('both authorized accounts can read and HEAD a published video without metadata leaks',async()=>{
      for(const id of [memberA,memberB]) {
        const response=await request('/media/'+video.id,{id});
        assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'video/mp4');
        assert.equal(response.headers.get('Content-Length'),String(fixture.length));assert.equal(response.headers.get('Accept-Ranges'),'bytes');
        assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture);
        const head=await request('/media/'+video.id,{id,method:'HEAD',range:'bytes=32-47'});
        assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),String(fixture.length));
        assert.equal(head.headers.get('Content-Range'),null);assert.equal((await head.arrayBuffer()).byteLength,0);
      }
      for(const method of ['GET','HEAD']) {
        for(const [id,status] of [[null,401],['video-site-outsider',403]]) {
          const response=await request('/media/'+video.id,{id,method,range:'bytes=0-0'});
          assert.equal(response.status,status);assert.equal(response.headers.get('Content-Range'),null);
        }
      }
    });
    await t.test('single byte ranges seek correctly, including suffixes and EOF clamping',async()=>{
      for(const [range,start,end] of [['bytes=32-47',32,47],['bytes=64-',64,127],['bytes=-16',112,127],['bytes=0-999',0,127],['bytes=-999',0,127],['bytes=0-0',0,0]]) {
        const response=await request('/media/'+video.id,{id:memberB,range});
        assert.equal(response.status,206,range);assert.equal(response.headers.get('Content-Range'),`bytes ${start}-${end}/${fixture.length}`);
        assert.equal(response.headers.get('Content-Length'),String(end-start+1));assert.equal(response.headers.get('Accept-Ranges'),'bytes');
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture.subarray(start,end+1));
      }
      for(const range of ['bytes=128-','bytes=60-20','bytes=-0','bytes=-','bytes=0-1,4-5','items=0-1','bytes=a-b','bytes=9007199254740992-']) {
        const response=await request('/media/'+video.id,{range});
        assert.equal(response.status,416,range);assert.equal(response.headers.get('Content-Range'),'bytes */128');
        assert.equal((await response.arrayBuffer()).byteLength,0);
      }
    });
    await t.test('stream requests fall back to the original before a derivative exists',async()=>{
      const path='/media/'+video.id+'?variant=stream';
      const response=await request(path,{id:memberB});
      assert.equal(response.status,200);assert.equal(response.headers.get('Content-Length'),String(fixture.length));
      assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('ETag'),null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture);
      const head=await request(path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),String(fixture.length));
      const seek=await request(path,{range:'bytes=64-79'});assert.equal(seek.status,206);assert.equal(seek.headers.get('Content-Range'),'bytes 64-79/128');
      assert.deepEqual(Buffer.from(await seek.arrayBuffer()),fixture.subarray(64,80));
    });
    await t.test('optimized stream playback and seek use derivative length and bytes while preserving the original',async()=>{
      const row=await db.prepare('SELECT key FROM media WHERE id=?').bind(video.id).first();
      await bucket.put(privatePreviewKey(row.key,'stream'),streamFixture,{httpMetadata:{contentType:'video/mp4'}});
      const path='/media/'+video.id+'?variant=stream';
      for(const id of [memberA,memberB]) {
        const response=await request(path,{id,headers:{'If-None-Match':'*'}});
        assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'video/mp4');assert.equal(response.headers.get('Content-Length'),String(streamFixture.length));
        assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('ETag'),null);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),streamFixture);
        const head=await request(path,{id,method:'HEAD',range:'bytes=32-47'});assert.equal(head.status,200);
        assert.equal(head.headers.get('Content-Length'),String(streamFixture.length));assert.equal(head.headers.get('Content-Range'),null);assert.equal((await head.arrayBuffer()).byteLength,0);
      }
      for(const [range,start,end] of [['bytes=32-47',32,47],['bytes=64-',64,79],['bytes=-16',64,79],['bytes=0-999',0,79]]) {
        const response=await request(path,{id:memberB,range});assert.equal(response.status,206);
        assert.equal(response.headers.get('Content-Range'),`bytes ${start}-${end}/${streamFixture.length}`);assert.equal(response.headers.get('Content-Length'),String(end-start+1));
        assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),streamFixture.subarray(start,end+1));
      }
      for(const range of ['bytes=80-','bytes=60-20','bytes=-0','bytes=0-1,4-5']) {
        const response=await request(path,{range});assert.equal(response.status,416);assert.equal(response.headers.get('Content-Range'),'bytes */80');
        assert.equal(response.headers.get('Content-Length'),'0');assert.equal((await response.arrayBuffer()).byteLength,0);
      }
      for(const [id,status] of [[null,401],['video-site-outsider',403]])for(const method of ['GET','HEAD']) {
        const denied=await request(path,{id,method,range:'bytes=80-'});assert.equal(denied.status,status);assert.equal(denied.headers.get('Content-Range'),null);assert.equal(denied.headers.get('ETag'),null);
      }
      for(const variant of ['thumb','display'])assert.equal((await request('/media/'+video.id+'?variant='+variant)).status,400);
      const original=await request('/media/'+video.id);assert.equal(original.headers.get('Content-Length'),String(fixture.length));assert.deepEqual(Buffer.from(await original.arrayBuffer()),fixture);
    });
    await t.test('draft video bytes remain author-only for GET, HEAD and Range',async()=>{
      const uploaded=await upload();assert.equal(uploaded.status,200);draftVideo=await uploaded.json();
      const saved=await request('/entries',{method:'POST',data:{requestId:'video-test-draft',kind:'letter',status:'draft',text:'Private draft',date:'2026-10-09',media:[draftVideo.id]}});
      assert.equal(saved.status,200);draft=await saved.json();
      const row=await db.prepare('SELECT key FROM media WHERE id=?').bind(draftVideo.id).first();
      await bucket.put(privatePreviewKey(row.key,'stream'),streamFixture,{httpMetadata:{contentType:'video/mp4'}});
      const other=await (await request('/house',{id:memberB})).json();assert.equal(other.entries.some(entry=>entry.id===draft.id),false);
      for(const method of ['GET','HEAD']) {
        const own=await request('/media/'+draftVideo.id,{method,range:'bytes=0-15'});
        assert.equal(own.status,method==='GET'?206:200);await own.arrayBuffer();
        const denied=await request('/media/'+draftVideo.id,{id:memberB,method,range:'bytes=128-'});
        assert.equal(denied.status,404);assert.equal(denied.headers.get('Content-Range'),null);
        const ownStream=await request('/media/'+draftVideo.id+'?variant=stream',{method,range:'bytes=32-47'});
        assert.equal(ownStream.status,method==='GET'?206:200);await ownStream.arrayBuffer();
        const deniedStream=await request('/media/'+draftVideo.id+'?variant=stream',{id:memberB,method,range:'bytes=80-'});
        assert.equal(deniedStream.status,404);assert.equal(deniedStream.headers.get('Content-Range'),null);
      }
      assert.equal((await request('/entries',{id:memberB,method:'POST',data:{kind:'memory',text:'Cannot steal attachment',media:[draftVideo.id]}})).status,403);
    });
    await t.test('only authors trash memory videos, and permanent deletion stops serving bytes',async()=>{
      const row=await db.prepare('SELECT key FROM media WHERE id=?').bind(video.id).first();
      const draftRow=await db.prepare('SELECT key FROM media WHERE id=?').bind(draftVideo.id).first();
      for(const variant of ['thumb','display'])await bucket.put(privatePreviewKey(row.key,variant),Buffer.from('legacy fixture'));
      assert.equal((await request('/entries/'+published.id,{id:memberB,method:'DELETE'})).status,403);
      assert.equal((await request('/entries/'+published.id,{method:'DELETE'})).status,200);
      assert.equal((await request('/entries/'+draft.id,{method:'DELETE'})).status,200);
      assert.equal((await request('/media/'+video.id,{method:'GET',range:'bytes=0-0'})).status,206);
      assert.equal((await request('/media/'+video.id,{method:'HEAD'})).status,200);
      assert.equal((await request('/media/'+video.id,{id:memberB})).status,404);
      for(const method of ['GET','HEAD']) {
        const own=await request('/media/'+video.id+'?variant=stream',{method,range:'bytes=32-47'});assert.equal(own.status,method==='GET'?206:200);await own.arrayBuffer();
        const denied=await request('/media/'+video.id+'?variant=stream',{id:memberB,method,range:'bytes=80-'});assert.equal(denied.status,404);assert.equal(denied.headers.get('Content-Range'),null);
      }
      const trashed=await (await request('/house')).json();
      assert.ok(trashed.recycledMedia.some(file=>file.id===video.id));
      await db.prepare('UPDATE media SET purge_started_at=? WHERE id=?').bind(new Date().toISOString(),video.id).run();
      for(const method of ['GET','HEAD'])assert.equal((await request('/media/'+video.id+'?variant=stream',{method,range:'bytes=0-0'})).status,404);
      assert.equal((await request('/media/'+video.id+'/permanent',{method:'DELETE'})).status,200);
      for(const id of [video.id,draftVideo.id]) {
        assert.equal((await request('/media/'+id,{method:'GET',range:'bytes=0-0'})).status,404);
        assert.equal((await request('/media/'+id,{method:'HEAD'})).status,404);
        assert.equal(await db.prepare('SELECT id FROM media WHERE id=?').bind(id).first(),null);
        for(const method of ['GET','HEAD'])assert.equal((await request('/media/'+id+'?variant=stream',{method,range:'bytes=0-0'})).status,404);
      }
      for(const key of privateMediaKeys(row.key))assert.equal(await bucket.head(key),null,key);
      for(let attempts=0;attempts<50&&await bucket.head(privatePreviewKey(draftRow.key,'stream'));attempts++)await new Promise(resolve=>setTimeout(resolve,10));
      for(const key of privateMediaKeys(draftRow.key))assert.equal(await bucket.head(key),null,key);
      const house=await (await request('/house')).json();assert.equal(house.meetings.length,14);assert.equal(house.entries.length,0);
    });
  } finally { await runtime.dispose(); }
});
