import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
test('invited email binds once to a stable identity and never transfers to another ID',async()=>{
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('dist/server/index.js','utf8'),compatibilityDate:'2026-10-01',d1Databases:{DB:'email-binding-verification'},r2Buckets:{BUCKET:'email-binding-media'},bindings:{AUTH_PROVIDER:'sites',MEMBER_EMAILS:JSON.stringify({yiting:'member-a@example.test',haomiao:'member-b@example.test'})}}));
  try {
    const db=await runtime.getD1Database('DB');
    for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')))for(const s of (await readFile(`drizzle/${f}`,'utf8')).split('--> statement-breakpoint'))if(s.trim())await db.prepare(s).run();
    const get=(id,email,path='/session')=>runtime.dispatchFetch('https://house.example/api'+path,{headers:{'oai-authenticated-user-id':id,'oai-authenticated-user-email':email}});
    assert.equal((await (await get('site-a','MEMBER-A@example.test')).json()).slot,'yiting');
    assert.equal((await (await get('site-b','member-b@example.test')).json()).slot,'haomiao');
    assert.equal((await get('other-id','member-a@example.test')).status,403);
    assert.equal((await get('site-c','outsider@example.test','/house')).status,403);
    assert.equal((await get('site-a','','/house')).status,403);
    assert.equal((await get('site-a','member-a@example.test','/house')).status,200);
  }finally{await runtime.dispose();}
});
