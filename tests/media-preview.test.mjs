import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {privatePreviewKey} from '../server/private-media-response.js';

test('private WebP previews preserve original files, ownership, draft/trash boundaries and deletion',async t=>{
  const origin='https://media-preview.example',memberA='preview-member-A',memberB='preview-member-B';
  const bundled=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const state=await mkdtemp(resolve('test-results','preview-state-'));
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-preview-db'},r2Buckets:{BUCKET:'isolated-preview-media'},resourcePersistencePath:state,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:memberA,haomiao:memberB})}}));
  const image=Uint8Array.from([255,216,255,224,0,0,0,0]);
  const webp=size=>{const bytes=new Uint8Array(size);bytes.set([82,73,70,70,0,0,0,0,87,69,66,80]);new DataView(bytes.buffer).setUint32(4,size-8,true);return bytes;};
  const thumb=webp(20),display=webp(28);
  async function request(path,{id=memberA,method='GET',data,form,raw,headers={}}={}) {
    const options={method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin,...(form?{}:{'Content-Type':raw?'image/webp':'application/json'})}),...headers},body:raw??form??(data===undefined?undefined:JSON.stringify(data))};
    if(form) {const encoded=new Request(origin+'/api'+path,options);options.headers=Object.fromEntries(encoded.headers);options.body=new Uint8Array(await encoded.arrayBuffer());}
    return runtime.dispatchFetch(origin+'/api'+path,options);
  }
  async function upload(bytes=image) {const form=new FormData();form.append('file',new Blob([bytes]),'private-photo');const response=await request('/upload',{method:'POST',form});assert.equal(response.status,200);return response.json();}
  async function entry(file,{kind='memory',status='published'}={}) {const response=await request('/entries',{method:'POST',data:{kind,status,text:'private fixture',media:[file.id],date:'2026-10-13'}});assert.equal(response.status,200);return response.json();}
  const save=(file,variant,bytes,options={})=>request('/media/'+file.id+'/preview/'+variant,{method:'PUT',raw:bytes,...options});
  let db,bucket,file,published,draftFile,draft;
  try {
    db=await runtime.getD1Database('DB');bucket=await runtime.getR2Bucket('BUCKET');
    for(const name of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+name,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
    await t.test('only the uploader can store bounded WebP derivatives after the mutation guard',async()=>{
      file=await upload();
      assert.equal((await save(file,'thumb',thumb,{id:null})).status,401);
      assert.equal((await save(file,'thumb',thumb,{id:memberB})).status,403);
      assert.equal((await save(file,'thumb',thumb,{headers:{'X-House-Request':'0'}})).status,403);
      assert.equal((await save(file,'thumb',image)).status,400);
      assert.equal((await save(file,'thumb',webp(256*1024+1))).status,413);
      assert.equal((await save(file,'display',webp(1024*1024+1))).status,413);
      const malformed=webp(20);new DataView(malformed.buffer).setUint32(4,999,true);
      assert.equal((await save(file,'thumb',malformed)).status,400);
      for(const [variant,bytes] of [['thumb',thumb],['display',display]])assert.equal((await save(file,variant,bytes)).status,200);
      const row=await db.prepare('SELECT key FROM media WHERE id=?').bind(file.id).first();
      assert.deepEqual(new Uint8Array(await (await bucket.get(row.key)).arrayBuffer()),image);
      for(const [variant,bytes] of [['thumb',thumb],['display',display]])assert.deepEqual(new Uint8Array(await (await bucket.get(privatePreviewKey(row.key,variant))).arrayBuffer()),bytes);
      const video=new Uint8Array(24);new DataView(video.buffer).setUint32(0,24);video.set([102,116,121,112],4);video.set([105,115,111,109],8);
      const clip=await upload(video);assert.equal((await save(clip,'thumb',thumb)).status,400);
    });
    await t.test('a published preview is shared privately and conditional responses disclose no unauthorized metadata',async()=>{
      assert.equal((await request('/media/'+file.id+'?variant=thumb',{id:memberB})).status,404);
      published=await entry(file);
      for(const id of [memberA,memberB])for(const [variant,bytes] of [['thumb',thumb],['display',display]]) {
        const response=await request('/media/'+file.id+'?variant='+variant,{id});assert.equal(response.status,200);
        assert.equal(response.headers.get('Content-Type'),'image/webp');assert.equal(response.headers.get('Cache-Control'),'private, no-cache, must-revalidate');assert.equal(response.headers.get('Vary'),'Cookie');
        const etag=response.headers.get('ETag');assert.ok(etag);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
        const conditional=await request('/media/'+file.id+'?variant='+variant,{id,headers:{'If-None-Match':etag}});assert.equal(conditional.status,304);
        assert.equal((await conditional.arrayBuffer()).byteLength,0);assert.equal(conditional.headers.get('Content-Length'),null);
      }
      const original=await request('/media/'+file.id);assert.equal(original.headers.get('Content-Type'),'image/jpeg');assert.deepEqual(new Uint8Array(await original.arrayBuffer()),image);
      for(const [id,status] of [[null,401],['preview-outsider',403]])for(const method of ['GET','HEAD']) {
        const denied=await request('/media/'+file.id+'?variant=thumb',{id,method,headers:{'If-None-Match':'*'}});assert.equal(denied.status,status);assert.equal(denied.headers.get('ETag'),null);assert.equal(denied.headers.get('Content-Range'),null);
      }
    });
    await t.test('draft and recently deleted previews do not bypass the original record checks',async()=>{
      draftFile=await upload();draft=await entry(draftFile,{kind:'letter',status:'draft'});assert.equal((await save(draftFile,'thumb',thumb)).status,200);
      for(const method of ['GET','HEAD']) {
        assert.equal((await request('/media/'+draftFile.id+'?variant=thumb',{method})).status,200);
        const denied=await request('/media/'+draftFile.id+'?variant=thumb',{id:memberB,method,headers:{'If-None-Match':'*'}});assert.equal(denied.status,404);assert.equal(denied.headers.get('ETag'),null);
      }
      assert.equal((await request('/media/'+file.id,{method:'DELETE'})).status,200);
      for(const method of ['GET','HEAD']) {
        assert.equal((await request('/media/'+file.id+'?variant=display',{method})).status,200);
        const denied=await request('/media/'+file.id+'?variant=display',{id:memberB,method,headers:{'If-None-Match':'*'}});assert.equal(denied.status,404);assert.equal(denied.headers.get('ETag'),null);
      }
      assert.equal((await request('/media/'+file.id+'/restore',{method:'POST'})).status,200);
      assert.equal((await request('/media/'+file.id+'?variant=thumb',{id:memberB})).status,200);
    });
    await t.test('purge markers block bytes and new previews, and deletion removes every private variant',async()=>{
      const row=await db.prepare('SELECT key FROM media WHERE id=?').bind(file.id).first();
      assert.equal((await request('/media/'+file.id,{method:'DELETE'})).status,200);
      await db.prepare('UPDATE media SET purge_started_at=? WHERE id=?').bind(new Date().toISOString(),file.id).run();
      assert.equal((await save(file,'thumb',thumb)).status,409);
      for(const variant of ['thumb','display'])for(const method of ['GET','HEAD']) {
        const denied=await request('/media/'+file.id+'?variant='+variant,{method,headers:{'If-None-Match':'*'}});assert.equal(denied.status,404);assert.equal(denied.headers.get('ETag'),null);
      }
      assert.equal((await request('/media/'+file.id+'/permanent',{method:'DELETE'})).status,200);
      for(const key of [row.key,privatePreviewKey(row.key,'thumb'),privatePreviewKey(row.key,'display')])assert.equal(await bucket.head(key),null);
      assert.equal(await db.prepare('SELECT id FROM media WHERE id=?').bind(file.id).first(),null);
      const draftRow=await db.prepare('SELECT key FROM media WHERE id=?').bind(draftFile.id).first();
      assert.equal((await request('/entries/'+draft.id,{method:'DELETE'})).status,200);
      // The existing hard-delete path finishes object cleanup through waitUntil.
      for(let attempts=0;attempts<50&&await bucket.head(privatePreviewKey(draftRow.key,'thumb'));attempts++)await new Promise(resolve=>setTimeout(resolve,10));
      for(const key of [draftRow.key,privatePreviewKey(draftRow.key,'thumb'),privatePreviewKey(draftRow.key,'display')])assert.equal(await bucket.head(key),null);
    });
  } finally {await runtime.dispose();}
});
