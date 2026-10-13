import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

test('album video order is shared, scoped and persistent without changing media rows',async t=>{
  const origin='https://video-order.example',members={yiting:'video-member-A',haomiao:'video-member-B'};
  const bundled=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  await mkdir('test-results',{recursive:true});
  const isolatedState=await mkdtemp(resolve('test-results','video-order-state-'));
  const options=convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-video-order-db'},r2Buckets:{BUCKET:'isolated-video-order-media'},resourcePersistencePath:isolatedState,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify(members)}});
  let runtime=new Miniflare(options),db;
  async function request(route,{id=members.yiting,method='GET',data,guard=true,requestOrigin=origin}={}) {
    return runtime.dispatchFetch(origin+'/api'+route,{method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'?{}:{'Content-Type':'application/json',...(guard?{'X-House-Request':'1'}:{}),origin:requestOrigin})},body:data===undefined?undefined:JSON.stringify(data)});
  }
  const success=async response=>assert.equal(response.status,200,await response.clone().text());
  const house=async(id=members.yiting)=>{const response=await request('/house',{id});await success(response);return response.json();};
  const settings=async()=>(await house()).settings;
  const reorder=async(kind,albumId,ids,extra={})=>request('/album-video-order',{method:'PUT',data:{kind,albumId,ids,version:(await settings()).version||0},...extra});
  async function entry(id,{author='yiting',meeting=null,kind='memory',status='published'}={}) {
    await db.prepare('INSERT INTO entries (id,kind,author,text,mood,date,meeting_id,status,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,kind,author,'Video order fixture','','2026-10-12',meeting,status,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z').run();
  }
  async function file(id,entryId,{type='video/mp4',owner='yiting',deleted=null,purge=null}={}) {
    await db.prepare('INSERT INTO media (id,owner,entry_id,key,type,name,deleted_at,purge_started_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,owner,entryId,'private/'+owner+'/'+id,type,'Isolated fixture',deleted,purge).run();
  }
  const unchanged=async(before)=>assert.deepEqual(await settings(),before);
  const dailyVideos=['daily-v1','daily-v2','daily-v3'],meetingVideos=['meeting-v1','meeting-v2','meeting-v3','meeting-v4'];
  try {
    db=await runtime.getD1Database('DB');
    for(const name of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+name,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
    await house();
    await db.prepare('INSERT INTO meetings (id,start,end,title,place,story) VALUES (?,?,?,?,?,?)').bind('video-meeting','2026-10-11','2026-10-12','Video meeting','','').run();
    await db.prepare('INSERT INTO meetings (id,start,end,title,place,story) VALUES (?,?,?,?,?,?)').bind('empty-video-meeting','2026-10-11','2026-10-12','Empty meeting','','').run();
    await entry('daily-videos');for(const id of dailyVideos)await file(id,'daily-videos');await file('daily-photo','daily-videos',{type:'image/webp'});
    await entry('meeting-owner-videos',{meeting:'video-meeting'});for(const id of meetingVideos.slice(0,2))await file(id,'meeting-owner-videos');
    await entry('meeting-peer-videos',{author:'haomiao',meeting:'video-meeting'});for(const id of meetingVideos.slice(2))await file(id,'meeting-peer-videos',{owner:'haomiao'});
    await entry('other-daily');await file('foreign-video','other-daily');
    await entry('draft-videos',{meeting:'video-meeting',status:'draft'});await file('draft-video','draft-videos');
    await entry('diary-videos',{kind:'diary'});await file('diary-video','diary-videos');
    await file('trash-video','daily-videos',{deleted:'2026-10-12T00:00:00.000Z'});
    await file('purging-video','daily-videos',{deleted:'2026-10-12T00:00:00.000Z',purge:'2026-10-12T00:00:01.000Z'});
    await file('unattached-video',null);
    await t.test('the second member reorders a daily album without altering media ownership, row order or content',async()=>{
      const before=await house(),rows=(await db.prepare('SELECT rowid AS source_order,* FROM media ORDER BY rowid').all()).results;
      const ids=[dailyVideos[2],dailyVideos[0],dailyVideos[1]],response=await reorder('daily','daily-videos',ids,{id:members.haomiao});await success(response);assert.deepEqual(await response.json(),{ok:true});
      for(const id of Object.values(members))assert.deepEqual((await house(id)).settings.videoOrders['daily:daily-videos'],ids);
      const after=await house();assert.equal(after.settings.version,(before.settings.version||0)+1);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.meetings,before.meetings);
      assert.deepEqual((await db.prepare('SELECT rowid AS source_order,* FROM media ORDER BY rowid').all()).results,rows);
      const {version:oldVersion,...old}=before.settings,{version:newVersion,videoOrders,...actual}=after.settings;assert.deepEqual(actual,old);
    });
    await t.test('a meeting order includes both members videos while preserving other albums',async()=>{
      const before=await settings(),ids=[...meetingVideos].reverse();await success(await reorder('meeting','video-meeting',ids,{id:members.haomiao}));
      const after=await settings();assert.deepEqual(after.videoOrders['meeting:video-meeting'],ids);assert.deepEqual(after.videoOrders['daily:daily-videos'],before.videoOrders['daily:daily-videos']);
      assert.equal((await request('/media/draft-video',{id:members.haomiao})).status,404);
    });
    await t.test('duplicates, missing videos, images, foreign, draft, trashed, purging and unattached IDs are rejected without changing settings',async()=>{
      const before=await settings();
      for(const ids of [[dailyVideos[0],dailyVideos[0],dailyVideos[2]],dailyVideos.slice(1),[...dailyVideos,'foreign-video'],['daily-photo',...dailyVideos.slice(1)],['missing-video',...dailyVideos.slice(1)],['draft-video',...dailyVideos.slice(1)],['trash-video',...dailyVideos.slice(1)],['purging-video',...dailyVideos.slice(1)],['unattached-video',...dailyVideos.slice(1)],['diary-video',...dailyVideos.slice(1)]]) {
        const response=await reorder('daily','daily-videos',ids);assert.equal(response.status,new Set(ids).size!==ids.length?400:403,await response.clone().text());await unchanged(before);
      }
      assert.equal((await reorder('meeting','video-meeting',[...meetingVideos,'draft-video'])).status,403);await unchanged(before);
    });
    await t.test('malformed payloads and unknown, associated, draft or non-memory scopes cannot save',async()=>{
      const before=await settings(),valid={kind:'daily',albumId:'daily-videos',ids:dailyVideos,version:before.version};
      for(const data of [null,[],true,{}, {...valid,kind:'other'}, {...valid,albumId:'invalid/key'}, {...valid,ids:null}, {...valid,ids:{}}, {...valid,ids:['invalid/key']}, {...valid,ids:[42]}, {...valid,version:-1}, {...valid,version:'0'}, {...valid,version:undefined}]) {
        const response=await request('/album-video-order',{method:'PUT',data});assert.equal(response.status,400,await response.clone().text());await unchanged(before);
      }
      for(const [kind,id] of [['daily','missing-album'],['daily','meeting-owner-videos'],['daily','draft-videos'],['daily','diary-videos'],['meeting','missing-meeting'],['meeting','empty-video-meeting']])assert.equal((await reorder(kind,id,[])).status,404);
      await unchanged(before);
    });
    await t.test('anonymous, outsiders, missing request guard and foreign origins cannot reorder',async()=>{
      const before=await settings();
      for(const [extra,status] of [[{id:null},401],[{id:'video-outsider'},403],[{guard:false},403],[{requestOrigin:'https://outsider.example'},403]])assert.equal((await reorder('daily','daily-videos',dailyVideos,extra)).status,status);
      await unchanged(before);
    });
    await t.test('stale orders conflict and regular settings cannot replace shared video orders',async()=>{
      const stale=await settings();await success(await reorder('daily','daily-videos',[dailyVideos[1],dailyVideos[2],dailyVideos[0]]));
      assert.equal((await request('/album-video-order',{method:'PUT',data:{kind:'daily',albumId:'daily-videos',ids:dailyVideos,version:stale.version}})).status,409);
      const before=await settings();await success(await request('/settings',{method:'PUT',data:{version:before.version,name:'A shared house',videoOrders:{'daily:daily-videos':['foreign-video']}}}));
      const after=await settings();assert.equal(after.name,'A shared house');assert.deepEqual(after.videoOrders,before.videoOrders);assert.deepEqual(after.people,before.people);assert.deepEqual(after.albumCovers,before.albumCovers);
      assert.equal((await request('/settings',{method:'PUT',data:{...stale,videoOrders:{}}})).status,409);
    });
    await t.test('trash and restoration preserve saved order and original media insertion position',async()=>{
      const before=await settings(),rows=(await db.prepare('SELECT rowid AS source_order,id,entry_id,owner FROM media ORDER BY rowid').all()).results;
      await success(await request('/media/'+dailyVideos[1],{method:'DELETE'}));assert.deepEqual((await settings()).videoOrders,before.videoOrders);
      assert.equal((await reorder('daily','daily-videos',dailyVideos)).status,403);
      await success(await request('/media/'+dailyVideos[1]+'/restore',{method:'POST'}));assert.deepEqual((await settings()).videoOrders,before.videoOrders);
      assert.deepEqual((await db.prepare('SELECT rowid AS source_order,id,entry_id,owner FROM media ORDER BY rowid').all()).results,rows);
    });
    await t.test('large meeting orders use constant SQL bindings rather than one per video',async()=>{
      await db.prepare('INSERT INTO meetings (id,start,end,title,place,story) VALUES (?,?,?,?,?,?)').bind('large-video-meeting','2026-10-11','2026-10-12','Large meeting','','').run();
      await entry('large-meeting-entry',{meeting:'large-video-meeting'});
      await db.prepare("WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<701) INSERT INTO media (id,owner,entry_id,key,type,name) SELECT 'large-video-'||n,'yiting','large-meeting-entry','private/yiting/large-video-'||n,'video/mp4','Isolated large fixture' FROM sequence").run();
      const ids=Array.from({length:701},(_,i)=>'large-video-'+(701-i));await success(await reorder('meeting','large-video-meeting',ids));assert.deepEqual((await settings()).videoOrders['meeting:large-video-meeting'],ids);
    });
    await t.test('saved daily and meeting orders survive restarting the worker',async()=>{
      const before=await settings();await runtime.dispose();runtime=new Miniflare(options);db=await runtime.getD1Database('DB');
      assert.deepEqual((await house(members.haomiao)).settings,before);assert.deepEqual((await house()).settings.videoOrders,before.videoOrders);
    });
  } finally {await runtime.dispose();}
});
