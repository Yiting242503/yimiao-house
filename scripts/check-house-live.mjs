import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const siteUrl=new URL(process.argv[2]),mediaId=process.argv[3];
assert.equal(siteUrl.protocol,'https:');
assert.equal(siteUrl.pathname,'/');
assert.ok(!siteUrl.search&&!siteUrl.hash&&!siteUrl.username&&!siteUrl.password);
const origin=siteUrl.origin;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext(),page=await context.newPage();

async function call(path,options={}) {
  assert.equal(new URL(page.url()).origin,origin);
  const response=await page.evaluate(async({path,options,origin})=>{
    if(location.origin!==origin)throw new Error('House origin changed');
    const target=new URL(path,location.origin);
    if(!path.startsWith('/')||target.origin!==location.origin)throw new Error('Invalid house path');
    const result=await fetch(target.pathname+target.search,{...options,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});
    return {status:result.status,body:await result.text()};
  },{path,options,origin});
  return {status:response.status,json:async()=>JSON.parse(response.body),text:async()=>response.body};
}

try {
  const landing=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(landing?.status(),200);
  assert.equal(new URL(page.url()).origin,origin);
  const session=await call('/api/session');assert.equal(session.status,200);
  assert.deepEqual(await session.json(),{localPreview:false,emailLogin:true,emailLoginReady:true,authorized:false,authenticated:false});
  assert.equal((await call('/api/house')).status,401);
  assert.equal((await call('/api/house',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'member-a@example.test'}})).status,401);
  assert.equal((await call('/api/dev-login',{method:'POST',headers:{'X-House-Request':'1','Content-Type':'application/json'},body:'{"slot":"yiting"}'})).status,404);
  assert.equal((await call('/api/auth/request-code',{method:'POST',headers:{'X-House-Request':'1','Content-Type':'application/json'},body:'{"email":"outsider@example.test"}'})).status,403);
  if(mediaId)for(const options of [{},{method:'HEAD'},{headers:{Range:'bytes=0-1'}}])assert.equal((await call('/api/media/'+encodeURIComponent(mediaId),options)).status,401);
assert.equal((await call('/api/house-transfer')).status,401);
  const home=await call('/');assert.equal(home.status,200);assert.ok((await home.text()).includes('意淼小屋'));
  console.log('PASS: email login ready; anonymous, forged identity, local login and outsiders denied; private media GET/HEAD/Range denied; transfer endpoint hidden from anonymous access.');
}finally{await browser.close();}
