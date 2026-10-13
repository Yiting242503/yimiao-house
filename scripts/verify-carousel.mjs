import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { reunionDays } from '../shared/dates.js';
import { initialMeetings } from '../shared/seed.js';

const base='http://127.0.0.1:5173';
const records=[], fixtureMeetings=[], fixtureMedia=[], checks=[], errors=[];
const fixtureRun=crypto.randomUUID();
const fixturePrefix=`TEST ${fixtureRun.slice(0,8)}`;
const mark=message=>{checks.push(message);console.log('PASS '+message);};
async function login(slot) {
  const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'Content-Type':'application/json','X-House-Request':'1'},body:JSON.stringify({slot})});
  assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
}
async function call(cookie,path,method='GET',data) {
  const response=await fetch(base+'/api'+path,{method,headers:{cookie,'X-House-Request':'1','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  assert.equal(response.status,200,await response.clone().text());return response.json();
}
const a=await login('yiting'),b=await login('haomiao');
const start=await call(a,'/house');
const meetings=[...start.meetings].sort((x,y)=>x.start.localeCompare(y.start));
assert.equal(meetings.length,14);assert.equal(reunionDays(meetings),48);
assert.deepEqual(meetings.map(m=>[m.start,m.end]),initialMeetings.map(m=>[m.start,m.end]));
await mkdir('test-results',{recursive:true});
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
async function context(width,height,reducedMotion='no-preference',cookie=a) {
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion,deviceScaleFactor:1});
  await ctx.addCookies([{name:'house_session',value:cookie.slice(cookie.indexOf('=')+1),url:base,httpOnly:true,sameSite:'Strict'}]);
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.getByRole('heading',{name:'意淼小屋',exact:true}).waitFor();
  await page.locator('.hotspot').filter({hasText:'见面日历'}).click();
  return {ctx,page};
}
async function open(page,meeting) {
  await page.locator('.meeting-summary').filter({has:page.getByText(meeting.title,{exact:true})}).click();
  await page.locator('.meeting-memory-modal').waitFor();
}
async function close(page) {await page.locator('.meeting-memory-modal').getByRole('button',{name:'关闭',exact:true}).click();}
try {
  const {ctx,page}=await context(1440,1000);
  for(const meeting of meetings) {
    await open(page,meeting);
    assert.equal(await page.locator('.meeting-memory-modal').getByRole('heading',{name:meeting.title,exact:true}).count(),1);
    assert.equal(await page.locator('.meeting-memory-modal img[src*="unsplash"]').count(),0);
    await close(page);
  }
  const empty=meetings.find(m=>!start.entries.some(e=>e.meeting_id===m.id&&e.media.length));
  if(empty) {
    await open(page,empty);await page.screenshot({path:'test-results/calendar-empty-desktop.png'});
    await page.getByRole('button',{name:'补上这次的照片',exact:true}).click();
    assert.equal(await page.getByLabel('关联一次见面').inputValue(),empty.id);
    assert.equal(await page.getByLabel('回忆日期').inputValue(),empty.start);
    await page.getByLabel('留下一句话').fill('Carousel draft preservation check');
    await page.getByRole('button',{name:'留待下次',exact:true}).click();
    await open(page,empty);await page.getByRole('button',{name:'补上这次的照片',exact:true}).click();
    assert.equal(await page.getByLabel('留下一句话').inputValue(),'Carousel draft preservation check');
    await page.getByRole('button',{name:'留待下次',exact:true}).click();
    await page.evaluate(id=>localStorage.removeItem(`house-draft:yiting:memory:${id}`),empty.id);
  }
  await ctx.close();mark('All 14 meetings open their own modal; empty state, associated upload and isolated draft persist.');

  // Fixture meetings keep uploaded test photos separate from the couple's real memories.
  const bytes=await readFile('public/assets/room.webp');
  for(const [index,count] of [[0,3],[1,1],[2,2]]) {
    const date=`2099-01-${String(index+1).padStart(2,'0')}`;
    const meeting={title:`${fixturePrefix} ${index+1}`,start:date,end:date,place:'TEST fixture',story:'Temporary carousel verification fixture'};
    const savedMeeting=await call(a,'/meetings','POST',meeting);
    fixtureMeetings.push({...meeting,id:savedMeeting.id});
    const media=[];
    for(let i=0;i<count;i++) {
      const form=new FormData();form.append('file',new Blob([bytes],{type:'image/webp'}),'carousel-verification.webp');
      const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie:a,'X-House-Request':'1'},body:form});
      assert.equal(response.status,200);
      const uploaded=(await response.json()).id;
      media.push(uploaded);fixtureMedia.push(uploaded);
    }
    const requestId=`carousel-${fixtureRun}-${index}`;
    records.push(requestId);
    const entry=await call(a,'/entries','POST',{requestId,kind:'memory',text:`Carousel verification fixture ${index+1}`,date,meetingId:savedMeeting.id,media});
    assert.equal(entry.id,requestId);
  }
  const shared=await call(b,'/house');
  assert.equal(shared.entries.filter(e=>records.includes(e.id)).length,3);
  for(const id of records) {
    const entry=shared.entries.find(e=>e.id===id);
    for(const file of entry.media) {
      assert.equal((await fetch(base+`/api/media/${file.id}`)).status,401);
      assert.equal((await fetch(base+`/api/media/${file.id}`,{headers:{cookie:b}})).status,200);
    }
  }
  mark('Meeting photo records and private media are shared across two separate login sessions, not anonymous visitors.');

  for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',360,800]]) {
    const {ctx,page}=await context(width,height,'no-preference',b);
    await open(page,fixtureMeetings[0]);
    await page.getByRole('button',{name:'编辑见面地点',exact:true}).click();
    await page.getByRole('textbox',{name:'见面地点',exact:true}).fill(`Location verification ${label}`);
    await page.getByRole('button',{name:'保存见面地点',exact:true}).click();
    await page.getByRole('button',{name:'编辑见面地点',exact:true}).waitFor();
    assert.equal((await call(a,'/house')).meetings.find(m=>m.id===fixtureMeetings[0].id).place,`Location verification ${label}`);
    await page.getByRole('button',{name:'编辑见面地点',exact:true}).click();
    await page.getByRole('textbox',{name:'见面地点',exact:true}).fill('Unsaved location verification');
    await page.getByRole('button',{name:'取消编辑地点',exact:true}).click();
    assert.ok((await page.getByRole('button',{name:'编辑见面地点',exact:true}).innerText()).includes(`Location verification ${label}`));
    const carousel=page.getByRole('region',{name:`${fixtureMeetings[0].title}的回忆照片`});
    await carousel.locator('[data-cc-index]').first().waitFor({state:'attached'});
    await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    await page.waitForTimeout(1600);
    assert.equal(await carousel.locator('[data-cc-index]').count(),3);
    assert.equal(await carousel.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true);
    const ring=carousel.locator('.circular-carousel__ring');
    await page.mouse.move(2,2);const before=await ring.getAttribute('style');await page.waitForTimeout(500);const after=await ring.getAttribute('style');assert.notEqual(before,after);
    await page.getByRole('button',{name:'下一张回忆',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.memory-counter')?.textContent?.trim()==='2 / 3');
    await carousel.focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>document.querySelector('.memory-counter')?.textContent?.trim()==='3 / 3');
    await page.waitForTimeout(600);
    const bounds=await page.locator('.meeting-memory-modal').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
    const image=await page.screenshot({path:`test-results/calendar-carousel-${label}.png`});
    const sharp=(await import('sharp')).default;
    const stats=await sharp(image).extract({left:Math.max(0,Math.round(bounds.x+20)),top:Math.round(bounds.y+130),width:Math.round(bounds.width-40),height:Math.min(200,Math.round(bounds.height-140))}).stats();
    assert.ok(stats.channels.some(channel=>channel.stdev>12),'Carousel screenshot must contain visible photographic detail.');
    await page.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
    await page.locator('.photo-viewer').waitFor();assert.equal(await page.locator('.photo-controls').innerText(),'3 / 3');
    await page.getByRole('button',{name:'关闭',exact:true}).last().click();
    await open(page,fixtureMeetings[1]);await page.locator('.single-meeting-photo img').evaluate(img=>img.decode());
    assert.equal(await page.locator('.single-meeting-photo').count(),1);await close(page);
    await open(page,fixtureMeetings[2]);await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    assert.equal(await page.locator('[data-cc-index]').count(),2);await close(page);
    await page.getByRole('button',{name:'回到小屋',exact:true}).click();
    assert.equal(await page.locator('.room-image').isVisible(),true);await ctx.close();
    mark(`${label}: photos render, ring moves, keyboard/buttons select the right full-size photo, 1/2-photo layouts and return home pass.`);
  }
  const {ctx:reducedCtx,page:reduced}=await context(390,844,'reduce');
  await open(reduced,fixtureMeetings[0]);await reduced.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
  const ring=reduced.locator('.circular-carousel__ring');const before=await ring.getAttribute('style');await reduced.waitForTimeout(700);assert.equal(await ring.getAttribute('style'),before);
  await reduced.getByRole('button',{name:'下一张回忆',exact:true}).click();await reduced.waitForFunction(()=>document.querySelector('.memory-counter')?.textContent?.trim()==='2 / 3');
  const positioned=await ring.getAttribute('style');await reduced.waitForTimeout(500);assert.equal(await ring.getAttribute('style'),positioned);
  await reduced.screenshot({path:'test-results/calendar-carousel-reduced-motion.png'});await reducedCtx.close();
  mark('Reduced motion disables automatic rotation and spring animation; explicit navigation still works.');
  assert.deepEqual(errors,[]);mark('No browser runtime errors.');
} finally {
  const cleanupErrors=[];
  try { await browser.close(); } catch(error) { cleanupErrors.push(error); }
  let cleanupHouse;
  try { cleanupHouse=await call(a,'/house'); } catch(error) { cleanupErrors.push(error); }
  if(cleanupHouse) {
    const existing=new Set(cleanupHouse.entries.map(e=>e.id));
    const linked=new Set(cleanupHouse.entries.filter(e=>records.includes(e.id)).flatMap(e=>e.media.map(m=>m.id)));
    const unattached=fixtureMedia.filter(id=>!linked.has(id));
    // Entry deletion owns media cleanup; adopt uploads left unattached by a failed fixture save.
    for(let offset=0;offset<unattached.length;offset+=6) {
      const requestId=`carousel-cleanup-${fixtureRun}-${offset}`;
      records.push(requestId);
      try {
        await call(a,'/entries','POST',{requestId,kind:'memory',text:'TEST carousel cleanup fixture',date:'2099-01-01',media:unattached.slice(offset,offset+6)});
        existing.add(requestId);
      } catch(error) { cleanupErrors.push(error); }
    }
    for(const id of records) {
      if(!existing.has(id)) continue;
      try { await call(a,`/entries/${id}`,'DELETE'); } catch(error) { cleanupErrors.push(error); }
    }
    const meetingIds=new Set([...fixtureMeetings.map(m=>m.id),...cleanupHouse.meetings.filter(m=>m.title.startsWith(fixturePrefix+' ')).map(m=>m.id)]);
    for(const id of meetingIds) {
      try { await call(a,`/meetings/${id}`,'DELETE'); } catch(error) { cleanupErrors.push(error); }
    }
  }
  if(cleanupErrors.length) throw new AggregateError(cleanupErrors,'Temporary carousel fixtures could not all be cleaned up.');
}
const end=await call(a,'/house');assert.equal(end.meetings.length,14);assert.equal(reunionDays(end.meetings),48);assert.equal(end.entries.some(e=>records.includes(e.id)),false);
assert.deepEqual([...end.meetings].sort((x,y)=>x.start.localeCompare(y.start)),meetings);
for(const entry of start.entries)assert.deepEqual(end.entries.find(e=>e.id===entry.id),entry);
mark('Temporary photos and meetings were removed; original records, real photos and 48 reunion dates are unchanged.');
await writeFile('test-results/carousel-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),checks,scope:'Local D1/R2; online Cloudflare access remains separately blocked.'},null,2));
