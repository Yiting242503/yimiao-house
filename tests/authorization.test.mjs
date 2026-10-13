import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

const workerScript=build({entryPoints:['server/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}).then(result=>result.outputFiles[0].text);

test('hosted authentication fails closed without an explicit supported provider',async t=>{
  for(const provider of [undefined,'unknown'])await t.test(provider===undefined?'missing provider':'unknown provider',async()=>{
    const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:await workerScript,compatibilityDate:'2026-10-01',d1Databases:{DB:'provider-guard-verification'},r2Buckets:{BUCKET:'provider-guard-media'},bindings:{LOCAL_PREVIEW:'true',MEMBER_IDS:JSON.stringify({yiting:'trusted-site-A',haomiao:'trusted-site-B'}),MEMBER_EMAILS:JSON.stringify({yiting:'member-a@example.test',haomiao:'member-b@example.test'}),...(provider===undefined?{}:{AUTH_PROVIDER:provider})}}));
    try {
      for(const path of ['/session','/house','/media/private-fixture'])for(const forged of [false,true]) {
        const response=await runtime.dispatchFetch('https://house.example/api'+path,{headers:forged?{'oai-authenticated-user-id':'trusted-site-A','oai-authenticated-user-email':'member-a@example.test',Cookie:'house_session=forged-local-session',Range:'bytes=0-1'}:{}});
        assert.equal(response.status,503,`${provider??'missing'} ${path} forged=${forged}`);
        assert.deepEqual(await response.json(),{error:'小屋登录暂未连接，请稍后再试'});
      }
      const login=await runtime.dispatchFetch('https://house.example/api/dev-login',{method:'POST',headers:{'X-House-Request':'1',origin:'https://house.example'},body:'{"slot":"yiting"}'});
      assert.equal(login.status,404);
    }finally{await runtime.dispose();}
  });
});

test('explicit localhost preview still logs in without a hosted provider',async()=>{
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:await workerScript,compatibilityDate:'2026-10-01',d1Databases:{DB:'local-provider-verification'},r2Buckets:{BUCKET:'local-provider-media'},bindings:{LOCAL_PREVIEW:'true'}}));
  try {
    const db=await runtime.getD1Database('DB');
    for(const file of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
    const anonymous=await runtime.dispatchFetch('http://127.0.0.1/api/session');
    assert.equal(anonymous.status,200);assert.deepEqual(await anonymous.json(),{authorized:false,authenticated:false,localPreview:true});
    const login=await runtime.dispatchFetch('http://127.0.0.1/api/dev-login',{method:'POST',headers:{'X-House-Request':'1',origin:'http://127.0.0.1'},body:'{"slot":"yiting"}'});
    assert.equal(login.status,200);
    const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const session=await (await runtime.dispatchFetch('http://127.0.0.1/api/session',{headers:{Cookie:cookie}})).json();
    assert.equal(session.slot,'yiting');assert.equal(session.authorized,true);assert.equal(session.localPreview,true);
    assert.equal((await runtime.dispatchFetch('https://house.example/api/house',{headers:{Cookie:cookie,'oai-authenticated-user-id':'trusted-site-A'}})).status,503);
  }finally{await runtime.dispose();}
});
test('hosted mode denies local login, checks both bound IDs and survives a runtime restart',async()=>{
  await mkdir('test-results',{recursive:true});
  const isolatedState=await mkdtemp(resolve('test-results','production-state-'));
  const config=convertV4MiniflareOptions({modules:true,script:await workerScript,compatibilityDate:'2026-10-01',d1Databases:{DB:'production-verification'},r2Buckets:{BUCKET:'production-media-verification'},resourcePersistencePath:isolatedState,bindings:{AUTH_PROVIDER:'sites',MEMBER_IDS:JSON.stringify({yiting:'trusted-site-A',haomiao:'trusted-site-B'})}});
  let runtime=new Miniflare(config);
  try {
    const db=await runtime.getD1Database('DB');
    const files=(await readdir('drizzle')).filter(f=>f.endsWith('.sql'));
    const initialized=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").first();
    if(!initialized)for(const file of files){const sql=await readFile(`drizzle/${file}`,'utf8');for(const statement of sql.split('--> statement-breakpoint')){if(statement.trim())await db.prepare(statement).run();}}
    const request=(path,id,method='GET',data)=>runtime.dispatchFetch(`https://house.example/api${path}`,{method,headers:{...(id?{'oai-authenticated-user-id':id}:{}),...(method==='GET'?{}:{'X-House-Request':'1','Content-Type':'application/json',origin:'https://house.example'})},body:data?JSON.stringify(data):undefined});
    assert.equal((await request('/house')).status,401);
    assert.equal((await request('/house','unauthorized-site-C')).status,403);
    assert.equal((await request('/dev-login','trusted-site-A','POST',{slot:'yiting'})).status,404);
    assert.equal((await runtime.dispatchFetch('http://127.0.0.1/api/dev-login',{method:'POST',headers:{'X-House-Request':'1'},body:'{"slot":"yiting"}'})).status,404);
    const saved=await (await request('/entries','trusted-site-A','POST',{kind:'diary',text:'Durability verification',date:'2026-10-09',author:'haomiao',requestId:'persist-verification'})).json();
    assert.equal(saved.ok,true);
    await request('/entries','trusted-site-A','POST',{kind:'diary',text:'Durability verification',date:'2026-10-09',requestId:'persist-verification'});
    const snapshot=await (await request('/house','trusted-site-B')).json();
    assert.equal(snapshot.entries.filter(e=>e.id===saved.id).length,1);assert.equal(snapshot.entries.find(e=>e.id===saved.id).author,'yiting');
    await runtime.dispose();runtime=new Miniflare(config);
    const after=await (await request('/house','trusted-site-B')).json();assert.ok(after.entries.some(e=>e.id===saved.id));
    assert.equal((await request(`/entries/${saved.id}`,'trusted-site-B','DELETE')).status,403);
    const s=after.settings;
    assert.equal((await request('/settings','trusted-site-A','PUT',{...s,name:'Verification home'})).status,200);
    assert.equal((await request('/settings','trusted-site-B','PUT',{...s,name:'Stale edit'})).status,409);
    await request('/settings','trusted-site-A','PUT',{...(await (await request('/house','trusted-site-A')).json()).settings,name:s.name});
    await request(`/entries/${saved.id}`,'trusted-site-A','DELETE');
    assert.equal((await (await request('/house','trusted-site-A')).json()).meetings.length,14);
  }finally{await runtime.dispose();}
});
