import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const members={yiting:'member-a@example.test',haomiao:'member-b@example.test'};
const users={yiting:'supabase:11111111-1111-4111-8111-111111111111',haomiao:'supabase:22222222-2222-4222-8222-222222222222'};
// Isolate the binding/query behavior under review; Auth transport is tested separately.
const bundle=await build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'verified-auth-fixture',setup(build){build.onLoad({filter:/[\\/]email-auth\.js$/},()=>({contents:`export function createEmailAuth(request,env){return {ready:true,resolveIdentity:async()=>env.FIXTURE_VERIFIED,decorateResponse:response=>response};}`,loader:'js'}));}}]});
const worker=(await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;

function database(state={}) {
  state.bindings??={...users};
  const calls=[];
  const db={calls,prepare(sql){return {bind(...params){const statement={sql,params,
    async first(){calls.push({method:'first',sql,params});
      if(sql.includes('SELECT user_id FROM members'))return state.bindings[params[0]]?{user_id:state.bindings[params[0]]}:null;
      if(sql.includes('SELECT id FROM markers'))return {id:'initial-meetings-v1'};
      if(sql.includes('SELECT m.*,e.id AS linked_entry_id'))return state.media??null;
      if(sql.includes("SELECT data FROM settings"))return {data:JSON.stringify(state.settings??{roomArt:'',people:{}})};
      assert.fail('Unexpected serial query: '+sql);
    },async run(){calls.push({method:'run',sql,params});
      if(sql.includes('INSERT OR IGNORE INTO members'))state.bindings[params[0]]??=state.racingIdentity??params[1];
      else assert.fail('Unexpected write: '+sql);
      return {meta:{changes:1}};
    },async all(){assert.fail('House reads should use the read-only batch');}};return statement;}};},
    async batch(statements){calls.push({method:'batch',statements});assert.equal(statements.length,8);assert.ok(statements.every(statement=>/^SELECT\b/.test(statement.sql)));
      return (state.snapshot??[[],[],[],[],[],[],[],[]]).map(results=>({results,success:true}));
    }};
  return db;
}
const env=(db,bucket={},slot='yiting')=>({DB:db,BUCKET:bucket,AUTH_PROVIDER:'supabase',MEMBER_EMAILS:JSON.stringify(members),FIXTURE_VERIFIED:{authenticated:true,userId:users[slot],verifiedEmail:members[slot]}});
const request=path=>new Request('https://house.example/api'+path);

test('already bound email members perform one binding read, no writes, and a changed binding denies the next request',async()=>{
  const state={},db=database(state),bindings=env(db);
  const allowed=await worker.fetch(request('/session'),bindings,{});
  assert.equal(allowed.status,200);assert.equal((await allowed.json()).authorized,true);
  assert.equal(db.calls.length,1);assert.equal(db.calls[0].method,'first');
  state.bindings.yiting='supabase:33333333-3333-4333-8333-333333333333';
  const denied=await worker.fetch(request('/session'),bindings,{});
  assert.equal(denied.status,403);assert.match((await denied.json()).error,/账号绑定已变更/);
  assert.equal(db.calls.length,2);assert.ok(db.calls.every(call=>call.method==='first'));
});

test('a first email binding still writes once and rechecks the pinned identity after a competing first login',async()=>{
  for(const racingIdentity of [null,'supabase:33333333-3333-4333-8333-333333333333']) {
    const state={bindings:{},racingIdentity},db=database(state);
    const response=await worker.fetch(request('/session'),env(db),{});
    assert.equal(response.status,racingIdentity?403:200);
    assert.deepEqual(db.calls.map(call=>call.method),['first','run','first']);
    assert.equal(state.bindings.yiting,racingIdentity??users.yiting);
    if(racingIdentity)assert.match((await response.json()).error,/此身份已经绑定到另一个账号/);
  }
});

test('joined media authorization rejects private or missing entries before R2 or ETag and retains room/avatar exceptions',async()=>{
  const baseline={id:'image-id',key:'private/yiting/image-id',owner:'yiting',type:'image/jpeg',entry_id:'entry-id',linked_entry_id:'entry-id',entry_author:'yiting',entry_status:'published',deleted_at:null,purge_started_at:null};
  const bytes=Uint8Array.from([255,216,255]);
  for(const [change,slot,settings,status] of [
    [{},'haomiao',{},200],
    [{entry_status:'draft'},'yiting',{},200],
    [{entry_status:'draft'},'haomiao',{},404],
    [{linked_entry_id:null},'yiting',{},404],
    [{deleted_at:'2026-10-13'},'haomiao',{},404],
    [{deleted_at:'2026-10-13'},'yiting',{},200],
    [{purge_started_at:'2026-10-13'},'yiting',{},404],
    [{entry_id:null},'haomiao',{},404],
    [{entry_id:null},'haomiao',{roomArt:'image-id'},200],
    [{entry_id:null},'haomiao',{people:{yiting:{avatar:'image-id'}}},200]
  ]) {
    const state={media:{...baseline,...change},settings},db=database(state),storage=[];
    const bucket={async head(key){storage.push(key);return {size:bytes.length,httpEtag:'"photo-etag"'};},async get(key){storage.push(key);return {size:bytes.length,httpEtag:'"photo-etag"',body:bytes};}};
    const response=await worker.fetch(new Request('https://house.example/api/media/image-id?variant=thumb',{headers:{'If-None-Match':'"different-etag"'}}),env(db,bucket,slot),{});
    assert.equal(response.status,status,JSON.stringify([change,slot,settings]));await response.arrayBuffer();
    assert.equal(db.calls.filter(call=>call.sql?.includes('linked_entry_id')).length,1);
    assert.equal(db.calls.some(call=>call.sql?.startsWith('SELECT * FROM entries')),false);
    if(status===404){assert.deepEqual(storage,[]);assert.equal(response.headers.get('ETag'),null);}
  }
});

test('house loads eight independent collections in one read-only D1 batch and preserves their ordering',async()=>{
  const settings={name:'fixture-house'},entries=[{id:'new',created:'2026-10-13'},{id:'old',created:'2026-10-12'}];
  const media=[{id:'media-z',entry_id:'new'},{id:'media-a',entry_id:'new'},{id:'old-media',entry_id:'old'}];
  const comments=[{id:'comment-old',entry_id:'new'},{id:'comment-new',entry_id:'new'}],hearts=[{id:'heart-z',entry_id:'old'},{id:'heart-a',entry_id:'new'}];
  const meetings=[{id:'meeting-new'},{id:'meeting-old'}],misses=[{id:'miss-new'},{id:'miss-old'}],recycled=[{id:'trash-new'},{id:'trash-old'}];
  const db=database({snapshot:[[{data:JSON.stringify(settings)}],entries,media,recycled,comments,hearts,meetings,misses]});
  const response=await worker.fetch(request('/house'),env(db),{});assert.equal(response.status,200);
  const house=await response.json();assert.deepEqual(house.settings,settings);assert.deepEqual(house.meetings,meetings);assert.deepEqual(house.misses,misses);assert.deepEqual(house.recycledMedia,recycled);
  assert.deepEqual(house.entries.map(entry=>entry.id),['new','old']);assert.deepEqual(house.entries[0].media.map(item=>item.id),['media-z','media-a']);assert.deepEqual(house.entries[0].comments,comments);
  assert.deepEqual(house.entries[0].hearts,[hearts[1]]);assert.deepEqual(house.entries[1].hearts,[hearts[0]]);
  const reads=db.calls.filter(call=>call.method==='batch');assert.equal(reads.length,1);assert.ok(reads[0].statements.every(statement=>/^SELECT\b/.test(statement.sql)));
  assert.equal(db.calls.some(call=>call.method==='run'),false);
});
