import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

test('personalized room artwork remains a privately shared image setting',async t=>{
  const origin='https://private-room.example',members=['room-member-A','room-member-B'];
  const bundle=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const isolated=await mkdtemp(resolve('test-results','room-state-'));
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:{DB:'private-room-tests'},r2Buckets:{BUCKET:'private-room-tests'},resourcePersistencePath:isolated,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:members[0],haomiao:members[1]})}}));
  async function request(route,{id=members[0],method='GET',data,form}={}) {
    const options={method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin,...(form?{}:{'Content-Type':'application/json'})})},body:form??(data===undefined?undefined:JSON.stringify(data))};
    if(form) {
      const encoded=new Request(origin+'/api'+route,options);
      options.headers=Object.fromEntries(encoded.headers);options.body=new Uint8Array(await encoded.arrayBuffer());
    }
    return runtime.dispatchFetch(origin+'/api'+route,options);
  }
  const house=async id=>(await request('/house',{id})).json();
  const upload=async(bytes,id=members[0])=>{
    const form=new FormData();form.append('file',new Blob([bytes]),'private-art');
    const response=await request('/upload',{id,method:'POST',form});assert.equal(response.status,200);return response.json();
  };
  const image=Buffer.from([255,216,255,224,0,0,0,0]);
  let art,other;
  try {
    const db=await runtime.getD1Database('DB');
    for(const file of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
    await t.test('new settings reject unknown, foreign, linked and video attachments',async()=>{
      art=await upload(image);other=await upload(image,members[1]);
      const linked=await upload(image);
      assert.equal((await request('/entries',{method:'POST',data:{kind:'letter',status:'draft',text:'isolated draft',media:[linked.id]}})).status,200);
      const video=Buffer.alloc(24);video.writeUInt32BE(24,0);video.write('ftyp',4);video.write('isom',8);video.write('isom',16);video.write('mp42',20);
      const clip=await upload(video);
      for(const roomArt of ['missing',other.id,linked.id,clip.id]) {
        const settings=(await house()).settings;
        assert.equal((await request('/settings',{method:'PUT',data:{...settings,roomArt}})).status,403);
      }
      assert.equal((await request('/media/'+art.id,{id:members[1]})).status,404);
      assert.equal((await request('/media/'+other.id)).status,404);
    });
    await t.test('owner can share an unassociated image without modifying other content',async()=>{
      const before=await house();
      assert.equal((await request('/settings',{method:'PUT',data:{...before.settings,roomArt:art.id}})).status,200);
      const after=await house(members[1]);
      assert.equal(after.settings.roomArt,art.id);assert.deepEqual(after.meetings,before.meetings);
      assert.equal(after.entries.some(entry=>entry.status==='draft'),false);
      for(const id of members)for(const method of ['GET','HEAD']) {
        const response=await request('/media/'+art.id,{id,method});assert.equal(response.status,200);
        assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
        if(method==='GET')assert.deepEqual(Buffer.from(await response.arrayBuffer()),image);
      }
    });
    await t.test('anonymous and outsider sessions cannot read the personalized scene or settings',async()=>{
      for(const [id,status] of [[null,401],['room-outsider',403]])for(const route of ['/house','/media/'+art.id]) {
        assert.equal((await request(route,{id})).status,status);
        if(route.startsWith('/media/'))assert.equal((await request(route,{id,method:'HEAD'})).status,status);
      }
    });
    await t.test('peer may retain the artwork in settings and stale saves remain rejected',async()=>{
      const before=(await house(members[1])).settings;
      assert.equal((await request('/settings',{id:members[1],method:'PUT',data:{...before,name:'Shared room setting'}})).status,200);
      const after=(await house()).settings;assert.equal(after.roomArt,art.id);assert.equal(after.name,'Shared room setting');
      assert.equal((await request('/settings',{method:'PUT',data:{...before,roomArt:''}})).status,409);
      assert.equal((await request('/media/'+art.id,{id:members[1]})).status,200);
    });
    await t.test('clearing the shared image restores author-only unassociated access',async()=>{
      const before=(await house(members[1])).settings;
      assert.equal((await request('/settings',{id:members[1],method:'PUT',data:{...before,roomArt:''}})).status,200);
      assert.equal((await request('/media/'+art.id,{id:members[1]})).status,404);
      assert.equal((await request('/media/'+art.id)).status,200);
      assert.equal((await house()).meetings.length,14);
    });
  } finally {await runtime.dispose();}
});
