import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { initialMeetings } from '../shared/seed.js';
import { reunionDays } from '../shared/dates.js';
const base='http://127.0.0.1:5173';
const report=[];
const mark=text=>{report.push(text);console.log('PASS '+text);};
async function call(cookie,path,method='GET',data,expected=200) {
  const headers={cookie:cookie||''};if(method!=='GET'){headers['X-House-Request']='1';headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  assert.equal(response.status,expected,`${method} ${path}: ${await response.clone().text()}`);
  return response.json();
}
async function login(slot) {
  const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'Content-Type':'application/json','X-House-Request':'1'},body:JSON.stringify({slot})});
  assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
}
const a=await login('yiting'),b=await login('haomiao');
await call(null,'/house','GET',undefined,401);await call(null,'/dev-login','POST',{slot:'stranger'},403);
mark('Anonymous and unauthorized identities cannot read the house.');
const start=await call(a,'/house');assert.equal(start.meetings.length,14);assert.equal(reunionDays(start.meetings),48);
assert.deepEqual([...start.meetings].sort((x,y)=>x.start.localeCompare(y.start)).map(m=>[m.start,m.end]),initialMeetings.map(m=>[m.start,m.end]));
const original=start.meetings.find(m=>m.id==='initial-14');
await call(a,'/meetings','POST',{...original,title:'Seed preservation check'});assert.equal((await call(b,'/house')).meetings.find(m=>m.id===original.id).title,'Seed preservation check');
await call(a,`/meetings/${original.id}`,'DELETE');assert.equal((await call(b,'/house')).meetings.length,13);await call(a,'/meetings','POST',original,404);
// A deleted seed is not recreated. Restore it explicitly without an update ID.
const restored=await call(a,'/meetings','POST',{...original,id:undefined});
mark('Seed initializes once, preserves edits and deletion; all supplied ranges total 48.');
const added=await call(a,'/meetings','POST',{title:'Verification only',start:'2026-12-30',end:'2027-01-02',place:'',story:''});
assert.equal(reunionDays((await call(b,'/house')).meetings),52);await call(b,`/meetings/${added.id}`,'DELETE');
await call(a,'/meetings','POST',{start:'2026-02-30',end:'2026-03-01'},400);
const diary=await call(a,'/entries','POST',{kind:'diary',text:'Verification record',date:'2026-10-09',mood:'平静',author:'haomiao'});
assert.equal((await call(b,'/house')).entries.find(e=>e.id===diary.id).author,'yiting');
await call(b,'/entries','POST',{id:diary.id,kind:'diary',text:'Tampered'},403);await call(b,`/entries/${diary.id}`,'DELETE',undefined,403);
await call(b,`/entries/${diary.id}/comments`,'POST',{text:'Verification reply'});await call(b,`/entries/${diary.id}/heart`,'POST',{});
let shared=(await call(a,'/house')).entries.find(e=>e.id===diary.id);assert.equal(shared.comments.length,1);assert.equal(shared.hearts.length,1);
await call(a,`/comments/${shared.comments[0].id}`,'DELETE',undefined,403);await call(b,`/comments/${shared.comments[0].id}`,'PUT',{text:'Updated reply'});
mark('Two independent sessions share records, replies and hearts; author spoofing and unauthorized edits rejected.');
const bytes=await readFile('public/assets/room.webp'),form=new FormData();form.append('file',new Blob([bytes],{type:'image/webp'}),'verification.webp');
const uploaded=await fetch(base+'/api/upload',{method:'POST',headers:{cookie:a,'X-House-Request':'1'},body:form});assert.equal(uploaded.status,200);const file=await uploaded.json();
assert.equal((await fetch(base+`/api/media/${file.id}`)).status,401);assert.equal((await fetch(base+`/api/media/${file.id}`,{headers:{cookie:b}})).status,404);
const draft=await call(a,'/entries','POST',{kind:'letter',text:'Private draft verification',date:'2026-10-09',status:'draft',media:[file.id]});
assert.equal((await call(b,'/house')).entries.some(e=>e.id===draft.id),false);await call(b,`/entries/${draft.id}/read`,'POST',{},404);assert.equal((await fetch(base+`/api/media/${file.id}`,{headers:{cookie:b}})).status,404);
await call(a,'/entries','POST',{id:draft.id,kind:'letter',text:'Published letter verification',date:'2026-10-09',status:'published',media:[file.id]});
assert.equal((await fetch(base+`/api/media/${file.id}`,{headers:{cookie:b}})).status,200);await call(b,`/entries/${draft.id}/read`,'POST',{});assert.ok((await call(a,'/house')).entries.find(e=>e.id===draft.id).read_at);
const badForm=new FormData();badForm.append('file',new Blob(['<script>bad</script>'],{type:'image/png'}),'fake.png');assert.equal((await fetch(base+'/api/upload',{method:'POST',headers:{cookie:a,'X-House-Request':'1'},body:badForm})).status,400);
assert.equal((await fetch(base+'/api/miss',{method:'POST',headers:{cookie:a,'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await fetch(base+'/api/miss',{method:'POST',headers:{cookie:a,'X-House-Request':'1',origin:'https://evil.example'},body:'{}'})).status,403);
mark('Private uploads, draft attachments, sent letters, read receipts, file validation and CSRF checks pass.');
await call(a,`/entries/${diary.id}`,'DELETE');await call(a,`/entries/${draft.id}`,'DELETE');assert.equal((await fetch(base+`/api/media/${file.id}`,{headers:{cookie:a}})).status,404);
const refreshed=await login('yiting');assert.equal((await call(refreshed,'/house')).meetings.length,14);
mark('Deletion removes media access; logout/login and fresh sessions retain the house.');

await mkdir('test-results',{recursive:true});
const systemEdge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({headless:true,...(existsSync(systemEdge)?{executablePath:systemEdge}:{})});
const errors=[];
try {
  for(const [label,width,height] of [['desktop',1440,1100],['wide',1920,1200],['mobile',390,844],['small-mobile',360,800]]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    const cookieValue=a.split('=')[1];await context.addCookies([{name:'house_session',value:cookieValue,url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByRole('heading',{name:'意淼小屋',exact:true}).waitFor();await page.locator('.room-image').evaluate(img=>img.decode());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label}: horizontal overflow`);
    assert.equal(await page.locator('.hotspot').count(),6);
    for(const name of ['一起走过','见面日历','隔着距离','今天的小事','写给你的话']) {
      await page.locator('.hotspot').filter({hasText:name}).click();await page.getByRole('button',{name:'回到小屋',exact:true}).click();
    }
    await page.locator('.hotspot').filter({hasText:'今天的小事'}).click();await page.getByRole('button',{name:'记一件小事',exact:true}).click();
    await page.getByRole('textbox',{name:'留下一句话'}).fill('Mobile draft preservation check');await page.getByRole('button',{name:'关闭',exact:true}).last().click();
    await page.getByRole('button',{name:'记一件小事',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'留下一句话'}).inputValue(),'Mobile draft preservation check');
    await page.getByRole('button',{name:'关闭',exact:true}).last().click();await page.getByRole('button',{name:'回到小屋',exact:true}).click();
    await page.evaluate(()=>localStorage.removeItem('house-draft:yiting:diary:new'));
    await page.screenshot({path:`test-results/${label}.png`,fullPage:true});
    if(label==='mobile'){await page.locator('.hotspot').filter({hasText:'见面日历'}).click();await page.screenshot({path:'test-results/mobile-calendar.png',fullPage:true});}
    await context.close();mark(`${label}: room hotspots, drawer return, mobile input, local draft and layout pass.`);
  }
  assert.deepEqual(errors,[]);mark('No browser runtime errors.');
} finally {await browser.close();}
await writeFile('test-results/verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),checks:report,scope:'Local D1/R2 preview; production account binding still required.'},null,2));
