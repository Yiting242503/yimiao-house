import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

test('daily album names and covers are shared settings bound to their original unassociated memory',async t=>{
  const origin='https://daily-album.example',memberA='daily-member-A',memberB='daily-member-B';
  const bundled=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const isolatedState=await mkdtemp(resolve('test-results','daily-album-state-'));
const options=convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-daily-album-db'},r2Buckets:{BUCKET:'isolated-daily-album-media'},resourcePersistencePath:isolatedState,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:memberA,haomiao:memberB})}});
  let runtime=new Miniflare(options),db,album;
  async function request(route,{id=memberA,method='GET',data,form}={}) {
    const params={method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin,...(form?{}:{'Content-Type':'application/json'})})},body:form??(data===undefined?undefined:JSON.stringify(data))};
    if(form){const encoded=new Request(origin+'/api'+route,params);params.headers=Object.fromEntries(encoded.headers);params.body=new Uint8Array(await encoded.arrayBuffer());}
    return runtime.dispatchFetch(origin+'/api'+route,params);
  }
  const house=async(id=memberA)=>{const response=await request('/house',{id});assert.equal(response.status,200,await response.clone().text());return response.json();};
  const save=async(dailyAlbums,id=memberA)=>request('/settings',{id,method:'PUT',data:{...(await house(id)).settings,dailyAlbums}});
  const successful=async response=>assert.equal(response.status,200,await response.clone().text());
  const image=Buffer.from([255,216,255,224,0,0,0,0]);
  const video=Buffer.alloc(24);video.writeUInt32BE(24,0);video.write('ftyp',4);video.write('isom',8);video.write('isom',16);video.write('mp42',20);
  async function fixture({id=memberA,count=1,kind='memory',status='published',meetingId='',bytes=image,unlinked=false}={}) {
    const files=[];
    for(let index=0;index<count;index++) {
      const form=new FormData();form.append('file',new Blob([bytes]),'daily-album-fixture-'+index);
      const response=await request('/upload',{id,method:'POST',form});await successful(response);files.push(await response.json());
    }
    if(unlinked)return {files};
    const response=await request('/entries',{id,method:'POST',data:{kind,status,meetingId,date:'2026-10-09',text:'Original daily album text',media:files.map(file=>file.id)}});await successful(response);
    return {id:(await response.json()).id,files};
  }
  try {
    db=await runtime.getD1Database('DB');
    for(const file of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
    await t.test('either member can rename a daily album and select another active photo without changing content',async()=>{
      album=await fixture({count:2});const before=await house(),metadata={name:'周末散步',cover:album.files[1].id};
      await successful(await save({[album.id]:metadata},memberB));
      for(const id of [memberA,memberB])assert.deepEqual((await house(id)).settings.dailyAlbums[album.id],metadata);
      const after=await house();assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.meetings,before.meetings);
      assert.equal(after.entries.find(entry=>entry.id===album.id).meeting_id,null);
      for(const id of [memberA,memberB])assert.equal((await request('/media/'+album.files[1].id,{id})).status,200);
    });
    await t.test('new cover references reject another album, associated memory, diary, draft, video, unlinked or missing media',async()=>{
      const other=await fixture(),associated=await fixture({meetingId:'initial-1'}),diary=await fixture({kind:'diary'}),draft=await fixture({kind:'letter',status:'draft'}),clip=await fixture({bytes:video}),unlinked=await fixture({unlinked:true}),peerUnlinked=await fixture({id:memberB,unlinked:true});
      for(const file of [other.files[0],associated.files[0],diary.files[0],draft.files[0],clip.files[0],unlinked.files[0],peerUnlinked.files[0],{id:'missing-daily-media'}])assert.equal((await save({[album.id]:{name:'Invalid cover',cover:file.id}})).status,403);
      for(const target of [associated,diary,draft,{id:'missing-daily-entry'}])assert.equal((await save({[target.id]:{name:'Invalid target',cover:album.files[0].id}})).status,403);
      assert.equal((await request('/media/'+draft.files[0].id,{id:memberB})).status,404);
      assert.equal((await request('/media/'+peerUnlinked.files[0].id)).status,404);
    });
    await t.test('malformed maps, metadata, names and IDs are rejected before changing settings',async()=>{
      const before=(await house()).settings.dailyAlbums;
      const invalid=[null,[],true,'invalid',{[album.id]:null},{[album.id]:[]},{[album.id]:{name:42,cover:''}},{[album.id]:{name:'x'.repeat(81),cover:''}},{[album.id]:{name:'safe',cover:42}},{[album.id]:{name:'safe',cover:'invalid/key'}},{'invalid/key':{name:'safe',cover:''}},JSON.parse('{"__proto__":{"name":"safe","cover":""}}')];
      for(const dailyAlbums of invalid)assert.equal((await save(dailyAlbums)).status,400);
      assert.equal((await save(Object.fromEntries(Array.from({length:251},(_,index)=>['daily-'+index,{name:'safe',cover:''}])))).status,400);
      assert.deepEqual((await house()).settings.dailyAlbums,before);
    });
    await t.test('anonymous and unauthorized accounts cannot edit names or covers',async()=>{
      const settings=(await house()).settings;
      for(const [id,status] of [[null,401],['daily-outsider',403]])assert.equal((await request('/settings',{id,method:'PUT',data:{...settings,dailyAlbums:{[album.id]:{name:'Unauthorized',cover:album.files[0].id}}}})).status,status);
    });
    await t.test('omitted metadata preserves daily albums and stale edits cannot overwrite a newer selection',async()=>{
      const old=(await house()).settings,metadata={name:'两个人的周末',cover:album.files[0].id};
      await successful(await save({[album.id]:metadata},memberB));
      const current=(await house()).settings;
      await successful(await request('/settings',{method:'PUT',data:{version:current.version,name:'Shared daily albums'}}));
      assert.deepEqual((await house()).settings.dailyAlbums[album.id],metadata);
      assert.equal((await request('/settings',{method:'PUT',data:{...old,dailyAlbums:{}}})).status,409);
      assert.deepEqual((await house()).settings.dailyAlbums[album.id],metadata);
    });
    await t.test('a stored trashed cover remains a fallback reference but cannot become a new selection',async()=>{
      const file=album.files[0],metadata=(await house()).settings.dailyAlbums[album.id];
      await successful(await request('/media/'+file.id,{method:'DELETE'}));
      assert.deepEqual((await house()).entries.find(entry=>entry.id===album.id).media.map(item=>item.id),[album.files[1].id]);
      await successful(await save({[album.id]:{...metadata,name:'The original cover can return'}},memberB));
      assert.equal((await request('/media/'+file.id,{id:memberB})).status,404);
      await successful(await save({[album.id]:{name:'Automatic daily cover',cover:''}}));
      assert.equal((await save({[album.id]:{name:'Cannot newly choose trash',cover:file.id}})).status,403);
      await successful(await request('/media/'+file.id+'/restore',{method:'POST'}));
      await successful(await save({[album.id]:{name:'Restored daily album',cover:file.id}},memberB));
      assert.equal((await request('/media/'+file.id,{id:memberB})).status,200);
    });
    await t.test('daily names and selected covers persist across backend restarts',async()=>{
      const before=(await house()).settings.dailyAlbums;
      await runtime.dispose();runtime=new Miniflare(options);db=await runtime.getD1Database('DB');
      const fresh=await house(memberB);assert.deepEqual(fresh.settings.dailyAlbums,before);
      assert.equal(fresh.entries.find(entry=>entry.id===album.id).meeting_id,null);
      assert.deepEqual(fresh.entries.find(entry=>entry.id===album.id).media.map(file=>file.id),album.files.map(file=>file.id));
      assert.equal((await request('/media/'+before[album.id].cover,{id:memberB})).status,200);
    });
  } finally {await runtime.dispose();}
});
