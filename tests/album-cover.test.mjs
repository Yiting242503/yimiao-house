import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

test('meeting album covers are shared image references, not new access grants',async t=>{
  const origin='https://album-cover.example',memberA='cover-member-A',memberB='cover-member-B';
  const bundled=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const isolatedState=await mkdtemp(resolve('test-results','cover-state-'));
const options=convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-cover-db'},r2Buckets:{BUCKET:'isolated-cover-media'},resourcePersistencePath:isolatedState,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:memberA,haomiao:memberB})}});
  let runtime=new Miniflare(options);
  async function request(route,{id=memberA,method='GET',data,form}={}) {
    const params={method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin,...(form?{}:{'Content-Type':'application/json'})})},body:form??(data===undefined?undefined:JSON.stringify(data))};
    if(form) {
      const encoded=new Request(origin+'/api'+route,params);
      params.headers=Object.fromEntries(encoded.headers);params.body=new Uint8Array(await encoded.arrayBuffer());
    }
    return runtime.dispatchFetch(origin+'/api'+route,params);
  }
  const house=async id=>(await request('/house',{id})).json();
  const save=async(albumCovers,id=memberA,extra={})=>request('/settings',{id,method:'PUT',data:{...(await house(id)).settings,albumCovers,...extra}});
  const image=Buffer.from([255,216,255,224,0,0,0,0]);
  const video=Buffer.alloc(24);video.writeUInt32BE(24,0);video.write('ftyp',4);video.write('isom',8);video.write('isom',16);video.write('mp42',20);
  async function fixture({id=memberA,meetingId='initial-1',kind='memory',status='published',bytes=image,unlinked=false}={}) {
    const form=new FormData();form.append('file',new Blob([bytes]),'isolated-cover');
    const uploaded=await request('/upload',{id,method:'POST',form});assert.equal(uploaded.status,200);const file=await uploaded.json();
    if(unlinked)return file;
    const entry=await request('/entries',{id,method:'POST',data:{kind,status,meetingId,text:'Isolated cover fixture',media:[file.id]}});
    assert.equal(entry.status,200);return {...file,entryId:(await entry.json()).id};
  }
  let first,peerPhoto;
  try {
    const db=await runtime.getD1Database('DB');
    for(const file of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
    await t.test('either member can select a published photo belonging to the same meeting',async()=>{
      first=await fixture();peerPhoto=await fixture({id:memberB});
      const before=await house();
      assert.equal((await save({'initial-1':peerPhoto.id})).status,200);
      assert.equal((await house(memberB)).settings.albumCovers['initial-1'],peerPhoto.id);
      assert.equal((await save({'initial-1':first.id},memberB)).status,200);
      const after=await house();assert.equal(after.settings.albumCovers['initial-1'],first.id);
      assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.meetings,before.meetings);
      for(const id of [memberA,memberB])assert.equal((await request('/media/'+first.id,{id})).status,200);
    });
    await t.test('new references reject other meetings, draft, diary, video, unlinked and missing media',async()=>{
      const wrongMeeting=await fixture({meetingId:'initial-2'});
      const draft=await fixture({kind:'letter',status:'draft'});
      const diary=await fixture({kind:'diary'});
      const clip=await fixture({bytes:video});
      const unlinked=await fixture({unlinked:true});
      for(const file of [wrongMeeting,draft,diary,clip,unlinked,{id:'missing-media'}])assert.equal((await save({'initial-1':file.id})).status,403);
      assert.equal((await save({'missing-meeting':first.id})).status,403);
      assert.equal((await request('/media/'+draft.id,{id:memberB})).status,404);
      assert.equal((await request('/media/'+unlinked.id,{id:memberB})).status,404);
    });
    await t.test('malformed maps are rejected and anonymous or unauthorized accounts cannot save',async()=>{
      for(const covers of [null,[],true,'invalid',{'initial-1':1},{'initial-1':''},{'initial-1':'a'.repeat(81)},{'invalid/key':first.id},JSON.parse('{"__proto__":"safe-id"}')])assert.equal((await save(covers)).status,400);
      const excess=Object.fromEntries(Array.from({length:251},(_,index)=>['meeting-'+index,'media-'+index]));assert.equal((await save(excess)).status,400);
      const settings=(await house()).settings;
      for(const [id,status] of [[null,401],['cover-outsider',403]]) {
        assert.equal((await request('/settings',{id,method:'PUT',data:{...settings,albumCovers:{'initial-1':first.id}}})).status,status);
        assert.equal((await request('/media/'+first.id,{id})).status,status);
      }
    });
    await t.test('omitted fields preserve the cover and stale edits cannot overwrite it',async()=>{
      const old=(await house()).settings;
      assert.equal((await request('/settings',{id:memberB,method:'PUT',data:{version:old.version,name:'Cover preserved'}})).status,200);
      assert.equal((await house()).settings.albumCovers['initial-1'],first.id);
      assert.equal((await request('/settings',{method:'PUT',data:{...old,albumCovers:{}}})).status,409);
    });
    await t.test('cover selections persist across a backend restart',async()=>{
      await runtime.dispose();runtime=new Miniflare(options);
      const fresh=await house(memberB);assert.equal(fresh.settings.albumCovers['initial-1'],first.id);
      assert.equal(fresh.settings.name,'Cover preserved');assert.equal((await request('/media/'+first.id,{id:memberB})).status,200);
    });
    await t.test('deleted media references may survive settings saves without granting access',async()=>{
      assert.equal((await request('/entries/'+first.entryId,{method:'DELETE'})).status,200);
      assert.equal((await save({'initial-1':first.id},memberB,{name:'Deleted cover fallback'})).status,200);
      assert.equal((await house()).settings.albumCovers['initial-1'],first.id);
      assert.equal((await request('/media/'+first.id,{id:memberB})).status,404);
      assert.equal((await save({},memberB)).status,200);assert.deepEqual((await house()).settings.albumCovers,{});
      assert.equal((await save({'initial-1':first.id})).status,403);
      assert.equal((await house()).meetings.length,14);
    });
  } finally {await runtime.dispose();}
});
