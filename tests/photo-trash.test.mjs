import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

test('album photos can be trashed, restored and permanently removed with owner-only access',async t=>{
  const origin='https://photo-trash.example',memberA='trash-member-A',memberB='trash-member-B';
  const bundled=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const isolatedState=await mkdtemp(resolve('test-results','photo-trash-state-'));
const options=convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-photo-trash-db'},r2Buckets:{BUCKET:'isolated-photo-trash-media'},resourcePersistencePath:isolatedState,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:memberA,haomiao:memberB})}});
  let runtime=new Miniflare(options),db,bucket;
  async function request(route,{id=memberA,method='GET',data,form,range}={}) {
    const payload=data===undefined?undefined:JSON.stringify(data);
    const params={method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin,...(form?{}:{'Content-Type':'application/json',...(payload?{'Content-Length':String(Buffer.byteLength(payload))}:{})})}),...(range===undefined?{}:{Range:range})},body:form??payload};
    if(form) {
      const encoded=new Request(origin+'/api'+route,params);
      params.headers=Object.fromEntries(encoded.headers);params.body=new Uint8Array(await encoded.arrayBuffer());
    }
    return runtime.dispatchFetch(origin+'/api'+route,params);
  }
  const house=async(id=memberA)=>{
    const response=await request('/house',{id});assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const trash=(file,id=memberA)=>request('/media/'+file.id,{id,method:'DELETE'});
  const restore=(file,id=memberA)=>request('/media/'+file.id+'/restore',{id,method:'POST'});
  const permanent=(file,id=memberA)=>request('/media/'+file.id+'/permanent',{id,method:'DELETE'});
  const image=Buffer.from([255,216,255,224,0,0,0,0]);
  const video=Buffer.alloc(24);video.writeUInt32BE(24,0);video.write('ftyp',4);video.write('isom',8);video.write('isom',16);video.write('mp42',20);
  async function upload({id=memberA,bytes=image,name='recovery-photo.jpg'}={}) {
    const form=new FormData();form.append('file',new Blob([bytes]),name);
    const response=await request('/upload',{id,method:'POST',form});assert.equal(response.status,200,await response.clone().text());return response.json();
  }
  async function fixture({id=memberA,count=1,kind='memory',meetingId='initial-1',bytes=image,text='Keep this original album memory',status='published'}={}) {
    const files=[];for(let index=0;index<count;index++)files.push(await upload({id,bytes,name:'recovery-'+index+(bytes===video?'.mp4':'.jpg')}));
    const data={kind,meetingId,date:'2026-10-09',text,status,media:files.map(file=>file.id)};
    const response=await request('/entries',{id,method:'POST',data});assert.equal(response.status,200,await response.clone().text());
    return {id:(await response.json()).id,files,data,actor:id};
  }
  const edit=(entry,media,id=entry.actor)=>request('/entries',{id,method:'POST',data:{...entry.data,id:entry.id,media}});
  const row=file=>db.prepare('SELECT * FROM media WHERE id=?').bind(file.id).first();
  const entryRow=entry=>db.prepare('SELECT * FROM entries WHERE id=?').bind(entry.id).first();
  const entryIn=(state,entry)=>state.entries.find(item=>item.id===entry.id);
  const recycledIn=(state,file)=>state.recycledMedia.find(item=>item.id===file.id);
  async function successful(response) {assert.equal(response.status,200,await response.clone().text());await response.arrayBuffer();}
  let persisted,fullAlbum;
  try {
    db=await runtime.getD1Database('DB');bucket=await runtime.getR2Bucket('BUCKET');
    for(const file of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();

    await t.test('single-photo deletion leaves sibling photos and keeps original recovery metadata',async()=>{
      const entry=await fixture({count:3}),[removed,...remaining]=entry.files;
      const before=await house();
      await successful(await trash(removed));
      const after=await house(),visible=entryIn(after,entry),recycled=recycledIn(after,removed),stored=await row(removed);
      assert.deepEqual(visible.media.map(file=>file.id).sort(),remaining.map(file=>file.id).sort());
      assert.equal(visible.text,entry.data.text);assert.equal(visible.meeting_id,entry.data.meetingId);
      assert.equal(recycled.entry_id,entry.id);assert.equal(recycled.entry_text,entry.data.text);assert.equal(recycled.date,entry.data.date);
      assert.equal(recycled.meeting_id,entry.data.meetingId);assert.equal(recycled.meeting_title,before.meetings.find(item=>item.id===entry.data.meetingId).title);
      assert.equal(recycled.name,removed.name);assert.equal(recycled.type,'image/jpeg');assert.ok(!Number.isNaN(Date.parse(recycled.deleted_at)));
      assert.equal(stored.entry_id,entry.id);assert.equal(stored.deleted_at,recycled.deleted_at);assert.notEqual(await bucket.head(stored.key),null);
      assert.deepEqual(after.meetings,before.meetings);
      await successful(await restore(removed));
      const restored=await house();assert.equal(recycledIn(restored,removed),undefined);
      assert.deepEqual(entryIn(restored,entry).media.map(file=>file.id).sort(),entry.files.map(file=>file.id).sort());
      assert.equal((await row(removed)).deleted_at,null);assert.equal((await row(removed)).entry_id,entry.id);
    });

    await t.test('fresh daily albums retain all 500 attachments and full-length Chinese text while 501 is rejected',async()=>{
      for(const count of [8,500]) {
        const entry=await fixture({count,meetingId:'',...(count===500?{text:'回'.repeat(8000)}:{})}),ids=entry.files.map(file=>file.id);
        assert.deepEqual(entryIn(await house(),entry).media.map(file=>file.id),ids);
        await successful(await edit(entry,ids));assert.deepEqual(entryIn(await house(),entry).media.map(file=>file.id),ids);
        if(count===500) {
          fullAlbum=entry;assert.equal(entryIn(await house(),entry).text,entry.data.text);
          assert.ok(Buffer.byteLength(JSON.stringify({...entry.data,id:entry.id}))>32000);
          const extra=await upload(),before=entryIn(await house(),entry);
          const excessive=await edit(entry,[...ids,extra.id]);assert.equal(excessive.status,400);
          assert.match((await excessive.json()).error,/这个相册.*500/);
          const requestId='overfull-fresh-album';
          const fresh=await request('/entries',{method:'POST',data:{...entry.data,requestId,media:[...ids,extra.id]}});
          assert.equal(fresh.status,400);assert.equal(await entryRow({id:requestId}),null);
          assert.deepEqual(entryIn(await house(),entry),before);assert.equal((await row(extra)).entry_id,null);
          const peerFile=await upload({id:memberB});
          assert.equal((await edit(entry,[...ids.slice(0,-1),peerFile.id])).status,403);
          assert.equal((await edit(entry,ids,memberB)).status,403);
          assert.deepEqual(entryIn(await house(),entry),before);assert.equal((await row(peerFile)).owner,'haomiao');assert.equal((await row(peerFile)).entry_id,null);
          const stored=(await db.prepare('SELECT id,owner,entry_id,deleted_at,purge_started_at FROM media WHERE entry_id=? ORDER BY rowid').bind(entry.id).all()).results;
          assert.deepEqual(stored.map(file=>file.id),ids);
          for(const file of stored){assert.equal(file.owner,'yiting');assert.equal(file.entry_id,entry.id);assert.equal(file.deleted_at,null);assert.equal(file.purge_started_at,null);}
        }
      }
    });

    await t.test('editing 75 existing attachments accepts all 425 additional files and rejects 501 without truncation',async()=>{
      const entry=await fixture({count:75,meetingId:''}),original=entry.files.map(file=>file.id),additional=[];
      for(let index=0;index<425;index++)additional.push(await upload({name:'appended-'+index+'.jpg'}));
      const ids=[...original,...additional.map(file=>file.id)];
      await successful(await edit(entry,ids));
      const before=entryIn(await house(),entry);assert.deepEqual(before.media.map(file=>file.id),ids);
      assert.equal(before.id,entry.id);assert.equal(before.text,entry.data.text);assert.equal(before.date,entry.data.date);
      const extra=await upload();assert.equal((await edit(entry,[...ids,extra.id])).status,400);
      assert.deepEqual(entryIn(await house(),entry),before);assert.equal((await row(extra)).entry_id,null);
      const stored=(await db.prepare('SELECT id,owner,entry_id,deleted_at FROM media WHERE entry_id=? ORDER BY rowid').bind(entry.id).all()).results;
      assert.deepEqual(stored.map(file=>file.id),ids);for(const file of stored){assert.equal(file.owner,'yiting');assert.equal(file.deleted_at,null);}
    });

    await t.test('the 500 limit combines both members and all batches in one meeting album, including concurrent saves and restores',async()=>{
      const created=await request('/meetings',{method:'POST',data:{start:'2026-10-09',end:'2026-10-10',title:'Capacity test meeting'}});
      assert.equal(created.status,200);const meetingId=(await created.json()).id;
      const total=async()=>Number((await db.prepare("SELECT COUNT(*) AS total FROM media m JOIN entries e ON m.entry_id=e.id WHERE e.kind='memory' AND e.status='published' AND e.meeting_id=? AND m.deleted_at IS NULL AND m.purge_started_at IS NULL").bind(meetingId).first()).total);
      fullAlbum.data.meetingId=meetingId;const ids=fullAlbum.files.map(file=>file.id);
      await successful(await edit(fullAlbum,ids));assert.equal(await total(),500);
      await successful(await edit(fullAlbum,ids.slice(0,498)));assert.equal(await total(),498);
      const peer=await fixture({id:memberB,count:2,meetingId});assert.equal(await total(),500);
      await successful(await edit(fullAlbum,ids.slice(0,498)));await successful(await edit(peer,peer.files.map(file=>file.id)));
      const extraA=await upload(),extraB=await upload({id:memberB}),before=entryIn(await house(),fullAlbum);
      const excess=await edit(fullAlbum,[...ids.slice(0,498),extraA.id]);assert.equal(excess.status,400);assert.match((await excess.json()).error,/这个相册.*500/);
      const peerData={kind:'memory',meetingId,date:'2026-10-09',text:'Extra peer batch',requestId:'full-meeting-extra-peer',media:[extraB.id]};
      assert.equal((await request('/entries',{id:memberB,method:'POST',data:peerData})).status,400);
      assert.equal(await entryRow({id:peerData.requestId}),null);assert.equal((await row(extraB)).entry_id,null);
      assert.deepEqual(entryIn(await house(),fullAlbum),before);
      assert.equal((await restore(fullAlbum.files[498])).status,409);assert.ok((await row(fullAlbum.files[498])).deleted_at);assert.equal(await total(),500);
      await successful(await trash(fullAlbum.files[0]));assert.equal(await total(),499);
      const races=[{actor:memberA,file:extraA,requestId:'meeting-race-A'},{actor:memberB,file:extraB,requestId:'meeting-race-B'}];
      const responses=await Promise.all(races.map(item=>request('/entries',{id:item.actor,method:'POST',data:{...peerData,requestId:item.requestId,media:[item.file.id]}})));
      assert.equal(responses.filter(response=>response.status===200).length,1);
      assert.ok(responses.every(response=>[200,400,409].includes(response.status)));assert.equal(await total(),500);
      const winner=races[responses.findIndex(response=>response.status===200)],loser=races[responses.findIndex(response=>response.status!==200)];
      assert.equal((await row(winner.file)).entry_id,winner.requestId);assert.equal((await row(loser.file)).entry_id,null);assert.equal(await entryRow({id:loser.requestId}),null);
      await successful(await trash(winner.file,winner.actor));assert.equal(await total(),499);
      await successful(await restore(fullAlbum.files[0]));assert.equal(await total(),500);
      await successful(await restore(fullAlbum.files[0]));assert.equal(await total(),500);
      assert.deepEqual(entryIn(await house(),fullAlbum).media.map(file=>file.id),ids.slice(0,498));
      assert.deepEqual(entryIn(await house(),peer).media.map(file=>file.id),peer.files.map(file=>file.id));
    });

    await t.test('diaries and letter drafts still accept six attachments and reject a seventh',async()=>{
      for(const kind of ['diary','letter']) {
        const entry=await fixture({kind,count:6,meetingId:'',status:kind==='letter'?'draft':'published'}),ids=entry.files.map(file=>file.id),extra=await upload();
        const before=entryIn(await house(),entry);
        assert.equal((await edit(entry,[...ids,extra.id])).status,400);
        const requestId='too-many-'+kind;
        assert.equal((await request('/entries',{method:'POST',data:{...entry.data,requestId,media:[...ids,extra.id]}})).status,400);
        assert.equal(await entryRow({id:requestId}),null);assert.equal((await row(extra)).entry_id,null);
        assert.deepEqual(entryIn(await house(),entry),before);assert.deepEqual(before.media.map(file=>file.id),ids);
      }
    });

    await t.test('the last photo hides the memory while preserving its comments and hearts for restoration',async()=>{
      const entry=await fixture(),[file]=entry.files;
      await successful(await request('/entries/'+entry.id+'/comments',{id:memberB,method:'POST',data:{text:'Keep our reply'}}));
      await successful(await request('/entries/'+entry.id+'/heart',{id:memberB,method:'POST'}));
      const before=entryIn(await house(),entry),original=await entryRow(entry);
      await successful(await trash(file));
      for(const id of [memberA,memberB])assert.equal(entryIn(await house(id),entry),undefined);
      const retained=await entryRow(entry);assert.equal(retained.id,original.id);assert.equal(retained.text,original.text);assert.equal(retained.meeting_id,original.meeting_id);
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM comments WHERE entry_id=?').bind(entry.id).first()).total,1);
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM hearts WHERE entry_id=?').bind(entry.id).first()).total,1);
      await successful(await restore(file));
      for(const id of [memberA,memberB]) {
        const restored=entryIn(await house(id),entry);assert.deepEqual(restored.comments,before.comments);assert.deepEqual(restored.hearts,before.hearts);
        assert.equal(restored.id,entry.id);assert.equal(restored.media[0].id,file.id);assert.equal(restored.meeting_id,entry.data.meetingId);
      }
    });

    await t.test('trash snapshots and image or video previews remain private to each owner',async()=>{
      const mine=await fixture(),peer=await fixture({id:memberB,bytes:video}),mineFile=mine.files[0],peerFile=peer.files[0];
      await successful(await trash(mineFile));await successful(await trash(peerFile,memberB));
      for(const [owner,other,ownFile,otherFile,bytes] of [[memberA,memberB,mineFile,peerFile,image],[memberB,memberA,peerFile,mineFile,video]]) {
        const state=await house(owner);assert.ok(recycledIn(state,ownFile));assert.equal(recycledIn(state,otherFile),undefined);
        for(const method of ['GET','HEAD']) {
          const response=await request('/media/'+ownFile.id,{id:owner,method});assert.equal(response.status,200);
          assert.equal(response.headers.get('Cache-Control'),'private, no-store');
          if(method==='GET')assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
          const denied=await request('/media/'+ownFile.id,{id:other,method,range:'bytes=0-0'});assert.equal(denied.status,404);assert.equal(denied.headers.get('Content-Range'),null);
        }
        const ranged=await request('/media/'+ownFile.id,{id:owner,range:'bytes=0-0'});assert.equal(ranged.status,206);assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),bytes.subarray(0,1));
      }
      persisted={mine,peer,mineFile,peerFile};
    });

    await t.test('peer, anonymous and unauthorized accounts cannot trash, restore or permanently delete someone else’s photo',async()=>{
      const entry=await fixture(),[file]=entry.files;
      assert.equal((await trash(file,memberB)).status,403);
      assert.equal((await row(file)).deleted_at,null);
      await successful(await trash(file));
      for(const [id,status] of [[memberB,403],[null,401],['trash-outsider',403]]) {
        for(const operation of [trash,restore,permanent])assert.equal((await operation(file,id)).status,status);
        if(id!==memberB)for(const method of ['GET','HEAD'])assert.equal((await request('/media/'+file.id,{id,method})).status,status);
      }
      assert.notEqual((await row(file)).deleted_at,null);assert.notEqual(await bucket.head((await row(file)).key),null);
    });

    await t.test('permanent deletion requires trash and removes the R2 object and media metadata before reporting success',async()=>{
      const entry=await fixture({count:2}),[file,sibling]=entry.files,stored=await row(file);
      assert.equal((await permanent(file)).status,409);assert.equal((await row(file)).deleted_at,null);assert.notEqual(await bucket.head(stored.key),null);
      await successful(await trash(file));await successful(await permanent(file));
      assert.equal(await row(file),null);assert.equal(await bucket.head(stored.key),null);assert.equal(await bucket.get(stored.key),null);
      for(const id of [memberA,memberB])for(const method of ['GET','HEAD'])assert.equal((await request('/media/'+file.id,{id,method,range:'bytes=0-0'})).status,404);
      assert.equal((await restore(file)).status,404);assert.equal((await permanent(file)).status,404);
      assert.equal(recycledIn(await house(),file),undefined);assert.deepEqual(entryIn(await house(),entry).media.map(item=>item.id),[sibling.id]);
      assert.equal((await request('/media/'+sibling.id,{id:memberB})).status,200);
    });

    await t.test('trashed photos cannot be newly selected as an album cover or reattached by stale editor saves',async()=>{
      const entry=await fixture({count:2}),[file,sibling]=entry.files;
      const saveCovers=async covers=>request('/settings',{method:'PUT',data:{...(await house()).settings,albumCovers:covers}});
      await successful(await saveCovers({'initial-1':file.id}));await successful(await trash(file));
      await successful(await request('/settings',{method:'PUT',data:{...(await house()).settings,name:'Keep the cover fallback'}}));
      assert.equal((await house()).settings.albumCovers['initial-1'],file.id);
      await successful(await saveCovers({}));assert.equal((await saveCovers({'initial-1':file.id})).status,403);
      assert.equal((await edit(entry,[file.id,sibling.id])).status,409);
      const state=await house();assert.ok(recycledIn(state,file));assert.deepEqual(entryIn(state,entry).media.map(item=>item.id),[sibling.id]);
      const newRecord=await request('/entries',{method:'POST',data:{kind:'memory',text:'Cannot revive through another record',media:[file.id]}});assert.ok([403,409].includes(newRecord.status));
      await successful(await restore(file));await successful(await saveCovers({'initial-1':file.id}));
    });

    await t.test('saving a memory after removing one photo moves the omitted file to trash without detaching it',async()=>{
      const entry=await fixture({count:3}),[removed,...remaining]=entry.files;
      await successful(await edit(entry,remaining.map(file=>file.id)));
      const state=await house(),stored=await row(removed);assert.ok(recycledIn(state,removed));assert.equal(stored.entry_id,entry.id);assert.ok(stored.deleted_at);
      assert.deepEqual(entryIn(state,entry).media.map(file=>file.id).sort(),remaining.map(file=>file.id).sort());
      assert.equal((await request('/media/'+removed.id,{id:memberB})).status,404);
      await successful(await restore(removed));assert.equal(entryIn(await house(),entry).media.length,3);
    });

    await t.test('album trash rejects unlinked files and preserves diary and letter deletion behavior',async()=>{
      const unlinked=await upload();assert.equal((await trash(unlinked)).status,403);assert.equal((await row(unlinked)).deleted_at,null);
      for(const kind of ['diary','letter']) {
        const entry=await fixture({kind}),[file]=entry.files,stored=await row(file);
        assert.equal((await trash(file)).status,403);assert.equal((await row(file)).deleted_at,null);
        assert.equal(recycledIn(await house(),file),undefined);
        await successful(await request('/entries/'+entry.id,{method:'DELETE'}));
        assert.equal(await row(file),null);assert.equal(await entryRow(entry),null);
        assert.equal((await request('/media/'+file.id)).status,404);
        // Entry hard deletion schedules R2 cleanup using waitUntil; wait for that existing behavior.
        for(let attempt=0;attempt<20&&await bucket.head(stored.key);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
        assert.equal(await bucket.head(stored.key),null);
      }
    });

    await t.test('deleting a whole memory also keeps its original rows and allows individual photo restoration',async()=>{
      const entry=await fixture({count:2}),[first,second]=entry.files;
      await successful(await request('/entries/'+entry.id+'/comments',{id:memberB,method:'POST',data:{text:'Keep the whole memory reply'}}));
      await successful(await trash(first));
      await successful(await request('/entries/'+entry.id,{method:'DELETE'}));
      await successful(await request('/entries/'+entry.id,{method:'DELETE'}));
      const state=await house();assert.equal(entryIn(state,entry),undefined);assert.ok(await entryRow(entry));
      for(const file of entry.files)assert.equal(state.recycledMedia.filter(item=>item.id===file.id).length,1);
      assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM comments WHERE entry_id=?').bind(entry.id).first()).total,1);
      await successful(await restore(second));const revived=entryIn(await house(),entry);assert.deepEqual(revived.media.map(file=>file.id),[second.id]);assert.equal(revived.comments.length,1);
      assert.ok(recycledIn(await house(),first));
    });

    await t.test('repeat trash and restore requests never duplicate recovery records or resurrect permanently deleted media',async()=>{
      const entry=await fixture(),[file]=entry.files;
      await successful(await trash(file));const deletedAt=(await row(file)).deleted_at;
      const repeatedTrash=await trash(file);assert.equal(repeatedTrash.status,200);assert.equal((await row(file)).deleted_at,deletedAt);
      assert.equal((await house()).recycledMedia.filter(item=>item.id===file.id).length,1);
      await successful(await restore(file));const repeatedRestore=await restore(file);assert.equal(repeatedRestore.status,200);
      assert.equal((await row(file)).deleted_at,null);assert.equal(entryIn(await house(),entry).media.filter(item=>item.id===file.id).length,1);
      await successful(await trash(file));await successful(await permanent(file));assert.equal((await trash(file)).status,404);assert.equal((await restore(file)).status,404);
    });

    await t.test('a persisted interrupted purge cannot restore or serve bytes and can finish safely on retry',async()=>{
      const entry=await fixture(),[file]=entry.files,stored=await row(file);
      await successful(await trash(file));
      // Reproduce a crash after R2 deletion and before final metadata cleanup.
      const startedAt=new Date().toISOString();await db.prepare('UPDATE media SET purge_started_at=? WHERE id=?').bind(startedAt,file.id).run();await bucket.delete(stored.key);
      const recycled=recycledIn(await house(),file);assert.equal(recycled.purge_started_at,startedAt);
      for(const method of ['GET','HEAD'])assert.equal((await request('/media/'+file.id,{method})).status,404);
      assert.equal((await restore(file)).status,409);assert.equal((await edit(entry,[file.id])).status,409);
      assert.equal((await permanent(file,memberB)).status,403);
      await successful(await permanent(file));assert.equal(await row(file),null);assert.equal(await bucket.head(stored.key),null);assert.equal(recycledIn(await house(),file),undefined);
    });

    await t.test('restoration respects deliberate removal of the original meeting',async()=>{
      const created=await request('/meetings',{method:'POST',data:{start:'2026-10-09',end:'2026-10-10',title:'Disposable isolated meeting'}});assert.equal(created.status,200);
      const meetingId=(await created.json()).id,entry=await fixture({meetingId}),[file]=entry.files;
      await successful(await trash(file));await successful(await request('/meetings/'+meetingId,{method:'DELETE'}));
      const recycled=recycledIn(await house(),file);assert.equal(recycled.meeting_id,null);assert.equal(recycled.meeting_title,null);
      await successful(await restore(file));assert.equal(entryIn(await house(),entry).meeting_id,null);
      assert.equal((await house()).meetings.some(item=>item.id===meetingId),false);
    });

    await t.test('trash and its owner-only bytes persist through a backend restart',async()=>{
      const before=await house();assert.ok(recycledIn(before,persisted.mineFile));
      await runtime.dispose();runtime=new Miniflare(options);db=await runtime.getD1Database('DB');bucket=await runtime.getR2Bucket('BUCKET');
      const fresh=await house(),peerFresh=await house(memberB);
      assert.deepEqual(recycledIn(fresh,persisted.mineFile),recycledIn(before,persisted.mineFile));
      assert.equal(recycledIn(fresh,persisted.peerFile),undefined);assert.ok(recycledIn(peerFresh,persisted.peerFile));
      assert.equal(entryIn(fresh,persisted.mine),undefined);assert.equal((await request('/media/'+persisted.mineFile.id)).status,200);
      assert.equal((await request('/media/'+persisted.mineFile.id,{id:memberB})).status,404);
      await successful(await restore(persisted.mineFile));assert.equal(entryIn(await house(memberB),persisted.mine).media[0].id,persisted.mineFile.id);
    });
  } finally {await runtime.dispose();}
});
