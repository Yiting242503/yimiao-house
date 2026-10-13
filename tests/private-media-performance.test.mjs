import test from 'node:test';
import assert from 'node:assert/strict';
import {privateMediaResponse,privatePreviewKey} from '../server/private-media-response.js';
import worker from '../server/worker.js';

const originalKey='private/yiting/fixture-image';
const file={key:originalKey,type:'image/jpeg'};
const image=Uint8Array.from([255,216,255,224,0,0,0,0]);
const preview=Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80]);
function bucketFixture(objects) {
  const calls=[];
  const object=key=>{
    const stored=objects[key];
    return stored?{size:stored.bytes.length,httpEtag:`"${stored.etag}"`,body:stored.bytes}:null;
  };
  return {calls,async head(key){calls.push(['head',key]);return object(key);},async get(key,options){
    calls.push(['get',key,options]);const found=object(key);
    if(found&&options?.range)found.body=found.body.subarray(options.range.offset,options.range.offset+options.range.length);
    return found;
  }};
}

test('ordinary photo GET streams its selected private object in one R2 call',async()=>{
  for(const [suffix,key,bytes,type] of [['',originalKey,image,'image/jpeg'],['?variant=thumb',privatePreviewKey(originalKey,'thumb'),preview,'image/webp']]) {
    const bucket=bucketFixture({[key]:{bytes,etag:'fixture-etag'}});
    const response=await privateMediaResponse(new Request('https://house.example/api/media/image'+suffix),bucket,file);
    assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),type);
    assert.equal(response.headers.get('Content-Length'),String(bytes.length));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    assert.deepEqual(bucket.calls,[['get',key,undefined]]);
  }
});

test('missing derivatives fall back to the original, and cached preview bytes must revalidate',async()=>{
  const bucket=bucketFixture({[originalKey]:{bytes:image,etag:'original-etag'}});
  const response=await privateMediaResponse(new Request('https://house.example/api/media/image?variant=display'),bucket,file);
  assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.equal(response.headers.get('ETag'),'"original-etag"');
  assert.equal(response.headers.get('Cache-Control'),'private, no-cache, must-revalidate');assert.equal(response.headers.get('Vary'),'Cookie');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),image);
  assert.deepEqual(bucket.calls,[['get',privatePreviewKey(originalKey,'display'),undefined],['get',originalKey,undefined]]);
  bucket.calls.length=0;
  const cached=await privateMediaResponse(new Request('https://house.example/api/media/image?variant=display',{headers:{'If-None-Match':'"another", W/"original-etag"'}}),bucket,file);
  assert.equal(cached.status,304);assert.equal(cached.headers.get('Content-Length'),null);assert.equal((await cached.arrayBuffer()).byteLength,0);
  assert.deepEqual(bucket.calls,[['head',privatePreviewKey(originalKey,'display')],['head',originalKey]]);
});

test('new preview content replaces an original fallback, while HEAD and Range avoid whole-object reads',async()=>{
  const key=privatePreviewKey(originalKey,'display');
  const bucket=bucketFixture({[key]:{bytes:preview,etag:'new-preview-etag'}});
  const refreshed=await privateMediaResponse(new Request('https://house.example/api/media/image?variant=display',{headers:{'If-None-Match':'"old-original-etag"'}}),bucket,file);
  assert.equal(refreshed.status,200);assert.equal(refreshed.headers.get('ETag'),'"new-preview-etag"');await refreshed.arrayBuffer();
  assert.deepEqual(bucket.calls,[['head',key],['get',key,undefined]]);
  bucket.calls.length=0;
  const head=await privateMediaResponse(new Request('https://house.example/api/media/image?variant=display',{method:'HEAD',headers:{Range:'bytes=0-0'}}),bucket,file);
  assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'12');assert.equal(head.headers.get('Content-Range'),null);assert.deepEqual(bucket.calls,[['head',key]]);
  bucket.calls.length=0;
  const ranged=await privateMediaResponse(new Request('https://house.example/api/media/image?variant=display',{headers:{Range:'bytes=-4'}}),bucket,file);
  assert.equal(ranged.status,206);assert.equal(ranged.headers.get('Content-Range'),'bytes 8-11/12');
  assert.deepEqual(new Uint8Array(await ranged.arrayBuffer()),preview.subarray(8));
  assert.deepEqual(bucket.calls,[['head',key],['get',key,{range:{offset:8,length:4}}]]);
});

function fakeDatabase({marker=true,media=null}={}) {
  const calls=[];
  const db={calls,prepare(sql){return {bind(...params){return {
    async first(){calls.push(['first',sql]);
      if(sql.includes('SELECT user_id FROM members'))return {user_id:'member-A'};
      if(sql.includes('SELECT id FROM markers'))return marker?{id:'initial-meetings-v1'}:null;
      if(sql.includes('SELECT * FROM media'))return media;
      if(sql.includes("SELECT data FROM settings"))return {data:JSON.stringify({roomArt:'',people:{}})};
      return null;
    },async run(){calls.push(['run',sql]);return {meta:{changes:0}};},async all(){calls.push(['all',sql]);return {results:[]};}
  };}};},async batch(statements){calls.push(['batch',statements.length]);marker=true;return [];}};
  return db;
}
const envFor=(db,bucket)=>({DB:db,BUCKET:bucket,AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:'member-A',haomiao:'member-B'})});
const memberRequest=path=>new Request('https://house.example'+path,{headers:{'oai-authenticated-user-id':'member-A'}});

test('media requests bypass seed writes and current identity authorization runs before storage or cache validation',async()=>{
  const db=fakeDatabase({media:{...file,id:'fixture-image',owner:'yiting',entry_id:null}});
  const bucket=bucketFixture({[privatePreviewKey(originalKey,'thumb')]:{bytes:preview,etag:'preview-etag'}});
  const allowed=await worker.fetch(memberRequest('/api/media/fixture-image?variant=thumb'),envFor(db,bucket),{});
  assert.equal(allowed.status,200);await allowed.arrayBuffer();
  assert.equal(db.calls.some(call=>call[0]==='batch'||call[1]?.includes('markers')),false);
  bucket.calls.length=0;
  for(const [identity,status] of [[null,401],['outsider',403]]) {
    const request=new Request('https://house.example/api/media/fixture-image?variant=thumb',{headers:{...(identity?{'oai-authenticated-user-id':identity}:{}),'If-None-Match':'*'}});
    const denied=await worker.fetch(request,envFor(db,bucket),{});
    assert.equal(denied.status,status);assert.equal(denied.headers.get('ETag'),null);
  }
  assert.deepEqual(bucket.calls,[]);
});

test('existing seed marker prevents all initialization batches, while a missing marker seeds once',async()=>{
  for(const marker of [true,false]) {
    const db=fakeDatabase({marker}),env=envFor(db,{});
    for(let index=0;index<2;index++)assert.equal((await worker.fetch(memberRequest('/api/unknown'),env,{})).status,404);
    assert.equal(db.calls.filter(call=>call[0]==='batch').length,marker?0:1);
  }
});

test('a purge that completes during preview upload cannot leave a recreated derivative',async()=>{
  const db=fakeDatabase({media:{...file,id:'fixture-image',owner:'yiting',entry_id:null,purge_started_at:null}});
  const operations=[];
  const bucket={async put(key,bytes){operations.push(['put',key,bytes.length]);},async delete(key){operations.push(['delete',key]);}};
  // The original read sees a photo, but the post-upload query sees no surviving row.
  const request=new Request('https://house.example/api/media/fixture-image/preview/thumb',{method:'PUT',headers:{'oai-authenticated-user-id':'member-A','X-House-Request':'1',origin:'https://house.example','Content-Type':'image/webp'},body:preview});
  const response=await worker.fetch(request,envFor(db,bucket),{});
  assert.equal(response.status,409);
  const key=privatePreviewKey(originalKey,'thumb');
  assert.deepEqual(operations,[['put',key,preview.length],['delete',key]]);
});
