import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const secret='isolated-transfer-fixture-key-0123456789abcdef';
const origin='https://transfer.example';
const time='2026-10-12T00:00:00.000Z';
const ids={yiting:'supabase:11111111-1111-4111-8111-111111111111',haomiao:'supabase:22222222-2222-4222-8222-222222222222'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const worker=build({stdin:{contents:"import { handleHouseTransfer } from './server/house-transfer.js'; export default { fetch(request,env) { return handleHouseTransfer(request,env); } };",resolveDir:process.cwd(),sourcefile:'house-transfer-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}).then(result=>result.outputFiles[0].text);
const file=id=>({id,owner:'yiting',entry_id:id==='room-art'?null:'album-1',key:'private/yiting/'+id,type:'image/webp',name:id+'.webp',deleted_at:null,purge_started_at:null});
const manifest=()=>({
  version:1,
  tables:{
    settings:[{id:'house',data:JSON.stringify({name:'私人的小屋',version:7,people:{yiting:{name:'成员甲',avatar:''},haomiao:{name:'成员乙',avatar:''}},roomArt:'room-art',dailyAlbums:{'album-1':{name:'日常相册',cover:'photo-1'}}})}],
    meetings:[{id:'meeting-1',start:'2026-10-01',end:'2026-10-02',title:'一起见面',place:'南京',story:'保留的回忆'}],
    entries:[{id:'album-1',kind:'memory',author:'yiting',text:'保留的原文',mood:'平静',date:'2026-10-11',meeting_id:null,status:'published',created:time,updated:time,read_at:null}],
    media:[file('photo-2'),file('photo-1'),file('room-art')],
    comments:[{id:'reply-1',entry_id:'album-1',author:'haomiao',text:'共同的回复',created:time}],
    hearts:[{id:'heart-1',entry_id:'album-1',author:'haomiao'}],
    misses:[{id:'miss-1',author:'yiting',created:time}],
    markers:[{id:'initial-meetings-v1'}]
  },
  memberBindings:{yiting:{from:'old-site-A',to:ids.yiting},haomiao:{from:null,to:ids.haomiao}}
});

async function fixture(bindings={}) {
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:await worker,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-transfer-db'},r2Buckets:{BUCKET:'isolated-transfer-media'},bindings:{AUTH_PROVIDER:'supabase',HOUSE_TRANSFER_KEY:secret,HOUSE_TRANSFER_EXPIRES_AT:new Date(Date.now()+60*60*1000).toISOString(),...bindings}}));
  const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
  for(const filename of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+filename,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
  await db.prepare("INSERT INTO members(slot,user_id) VALUES ('yiting','old-site-A')").run();
  await db.prepare("INSERT INTO settings(id,data) VALUES ('house','{\"name\":\"old settings\"}')").run();
  await db.prepare("INSERT INTO meetings(id,start,end,title,place,story) VALUES ('old-meeting','2026-01-01','2026-01-02','old','','')").run();
  await db.prepare("INSERT INTO markers(id) VALUES ('initial-meetings-v1')").run();
  const call=(path='',{method='GET',body,headers={},url=origin,key=secret}={})=>runtime.dispatchFetch(url+'/api/house-transfer'+path,{method,headers:{'X-House-Transfer-Key':key,...headers},...(body===undefined?{}:{body})});
  const put=async(item,bytes=Buffer.from('private fixture '+item.id),headers={})=>call('/object?key='+encodeURIComponent(item.key),{method:'PUT',body:bytes,headers:{'Content-Type':item.type,'X-House-Content-SHA256':sha(bytes),...headers}});
  const upload=async(data)=>{for(const item of data.tables.media){const response=await put(item);assert.equal(response.status,200,await response.clone().text());}};
  const commit=async(data)=>call('/commit',{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json'}});
  return {runtime,db,bucket,call,put,upload,commit};
}

test('transfer entry stays hidden when disabled, expired, insecure or incorrectly authenticated',async()=>{
  for(const bindings of [{HOUSE_TRANSFER_KEY:''},{HOUSE_TRANSFER_KEY:'short'},{HOUSE_TRANSFER_EXPIRES_AT:new Date(Date.now()-1).toISOString()},{HOUSE_TRANSFER_EXPIRES_AT:new Date(Date.now()+3*60*60*1000).toISOString()},{AUTH_PROVIDER:'sites'}]) {
    const f=await fixture(bindings);
    try{assert.equal((await f.call()).status,404);}finally{await f.runtime.dispose();}
  }
  const f=await fixture();
  try {
    assert.equal((await f.call('',{key:'wrong'})).status,404);
    assert.equal((await f.call('',{url:'http://transfer.example'})).status,404);
    assert.equal((await f.call('',{url:'http://127.0.0.1'})).status,200);
    const status=await (await f.call()).json();
    assert.deepEqual(Object.keys(status).sort(),['committed','counts']);
    assert.equal(status.committed,false);assert.equal(status.counts.entries,0);assert.equal(status.counts.media,0);
    assert.ok(!JSON.stringify(status).includes('old-site-A'));
  }finally{await f.runtime.dispose();}
});

test('private objects verify their hash, retry safely and never overwrite existing storage',async()=>{
  const f=await fixture(),item=file('photo-1'),bytes=Buffer.from('original private bytes');
  try {
    assert.equal((await f.put(item,bytes,{'X-House-Content-SHA256':'0'.repeat(64)})).status,400);
    assert.equal(await f.bucket.head(item.key),null);
    assert.equal((await f.put(item,bytes,{'Content-Type':'text/html'})).status,400);
    assert.equal((await f.put({...item,key:'public/private-photo'},bytes)).status,400);
    const {handleHouseTransfer}=await import('../server/house-transfer.js');
    const oversized=await handleHouseTransfer(new Request(origin+'/api/house-transfer/object?key='+encodeURIComponent(item.key),{method:'PUT',body:bytes,headers:{'X-House-Transfer-Key':secret,'Content-Type':item.type,'X-House-Content-SHA256':sha(bytes),'Content-Length':String(52*1024*1024)}}),{AUTH_PROVIDER:'supabase',HOUSE_TRANSFER_KEY:secret,HOUSE_TRANSFER_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),DB:f.db,BUCKET:f.bucket});
    assert.equal(oversized.status,413);
    assert.equal((await f.put(item,bytes)).status,200);
    assert.equal((await (await f.put(item,bytes)).json()).idempotent,true);
    assert.equal((await f.put(item,Buffer.from('replacement'))).status,409);
    assert.equal(await (await f.bucket.get(item.key)).text(),bytes.toString());
    const legacy=file('legacy');
    await f.bucket.put(legacy.key,bytes,{httpMetadata:{contentType:'image/webp'}});
    assert.equal((await f.put(legacy,bytes)).status,409);
  }finally{await f.runtime.dispose();}
});

test('commit rejects malformed relations, unknown fields and absent private objects without altering defaults',async()=>{
  const f=await fixture();
  try {
    const unknown=manifest();unknown.tables.sessions=[];
    assert.equal((await f.commit(unknown)).status,400);
    const orphan=manifest();orphan.tables.media[0].entry_id='missing';
    assert.equal((await f.commit(orphan)).status,400);
    const owner=manifest();owner.tables.media[0].owner='haomiao';owner.tables.media[0].key='private/haomiao/photo-2';
    assert.equal((await f.commit(owner)).status,400);
    const duplicate=manifest();duplicate.memberBindings.haomiao.to=ids.yiting;
    assert.equal((await f.commit(duplicate)).status,400);
    assert.equal((await f.commit(manifest())).status,409);
    assert.equal((await f.db.prepare('SELECT title FROM meetings').first()).title,'old');
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM entries').first()).n,0);
    assert.equal((await f.db.prepare('SELECT user_id FROM members').first()).user_id,'old-site-A');
  }finally{await f.runtime.dispose();}
});

test('private copy preserves media order, ownership, settings and guarded identity bindings; repeat is idempotent',async()=>{
  const f=await fixture(),data=manifest();
  try {
    await f.upload(data);
    const response=await f.commit(data);assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.equal(result.committed,true);assert.equal(result.idempotent,false);
    assert.equal(result.counts.media,3);assert.equal(result.counts.entries,1);
    assert.deepEqual((await f.db.prepare('SELECT id FROM media ORDER BY rowid').all()).results.map(row=>row.id),['photo-2','photo-1','room-art']);
    assert.equal((await f.db.prepare('SELECT author FROM entries').first()).author,'yiting');
    assert.equal((await f.db.prepare("SELECT data FROM settings WHERE id='house'").first()).data,data.tables.settings[0].data);
    assert.deepEqual((await f.db.prepare('SELECT slot,user_id FROM members ORDER BY slot').all()).results,[{slot:'haomiao',user_id:ids.haomiao},{slot:'yiting',user_id:ids.yiting}]);
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,0);
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM auth_rate_limits').first()).n,0);
    assert.equal((await (await f.commit(data)).json()).idempotent,true);
    const changed=structuredClone(data);changed.tables.entries[0].text='different snapshot';
    assert.equal((await f.commit(changed)).status,409);
  }finally{await f.runtime.dispose();}
});

test('existing or concurrently added content and changed member bindings prevent an atomic commit',async()=>{
  for(const kind of ['existing','race','member']) {
    const f=await fixture(),data=manifest();
    try {
      await f.upload(data);
      const insert=()=>f.db.prepare("INSERT INTO misses(id,author,created) VALUES ('live-write','haomiao',?)").bind(time).run();
      if(kind==='existing')await insert();
      if(kind==='member')await f.db.prepare("UPDATE members SET user_id='changed-site' WHERE slot='yiting'").run();
      let response;
      if(kind==='race') {
        const proxy={prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{await insert();return f.db.batch(statements);}};
        const {handleHouseTransfer}=await import('../server/house-transfer.js');
        response=await handleHouseTransfer(new Request(origin+'/api/house-transfer/commit',{method:'POST',headers:{'X-House-Transfer-Key':secret},body:JSON.stringify(data)}),{AUTH_PROVIDER:'supabase',HOUSE_TRANSFER_KEY:secret,HOUSE_TRANSFER_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),DB:proxy,BUCKET:f.bucket});
      }else response=await f.commit(data);
      assert.equal(response.status,409,await response.clone().text());
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM media').first()).n,0);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM entries').first()).n,0);
      assert.equal((await f.db.prepare('SELECT title FROM meetings').first()).title,'old');
      assert.equal((await f.call()).status,200);assert.equal((await (await f.call()).json()).committed,false);
    }finally{await f.runtime.dispose();}
  }
});
