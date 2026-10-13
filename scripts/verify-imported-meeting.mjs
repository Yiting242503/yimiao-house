import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
const base='http://127.0.0.1:5173';
const report=JSON.parse(await readFile('test-results/first-meeting-import.json','utf8'));
async function login(slot) {
  const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'X-House-Request':'1','Content-Type':'application/json'},body:JSON.stringify({slot})});
  assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
}
const a=await login('yiting'),b=await login('haomiao');
for(const cookie of [a,b]) {
  const response=await fetch(base+'/api/house',{headers:{cookie}});const house=await response.json();
  const entries=house.entries.filter(e=>report.entryIds.includes(e.id));assert.equal(entries.reduce((n,e)=>n+e.media.length,0),report.photos);
  assert.ok(entries.every(e=>e.meeting_id===report.meeting.id&&e.author==='yiting'));
  const file=entries[0].media[0];
  assert.equal((await fetch(base+`/api/media/${file.id}`)).status,401);
  const photo=await fetch(base+`/api/media/${file.id}`,{headers:{cookie}});assert.equal(photo.status,200);
  const metadata=await sharp(Buffer.from(await photo.arrayBuffer())).metadata();assert.equal(metadata.exif,undefined);assert.ok(metadata.width<=2000&&metadata.height<=2000);
}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const errors=[];
try {
  for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    await context.addCookies([{name:'house_session',value:b.split('=')[1],url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await page.locator('.hotspot').filter({hasText:'见面日历'}).click();
    await page.locator('.meeting-summary').filter({has:page.getByText(report.meeting.title,{exact:true})}).click();
    await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    await page.waitForTimeout(1800);await page.mouse.move(2,2);
    await page.screenshot({path:`test-results/first-meeting-${label}.png`});
    console.log(JSON.stringify({viewport:label,photos:report.photos,cards:await page.locator('[data-cc-index]').count(),ring:await page.locator('.circular-carousel__ring').getAttribute('style')}));
    await page.getByRole('button',{name:'下一张回忆',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.memory-counter')?.textContent==='2 / 59');
    await page.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
    await page.locator('.photo-viewer img').evaluate(image=>image.decode());assert.equal(await page.locator('.photo-viewer img').evaluate(image=>image.naturalWidth>0),true);
    assert.equal((await page.locator('.photo-controls').innerText()).trim(),'2 / 6');
    await page.getByRole('button',{name:'关闭',exact:true}).last().click();
    await page.locator('.meeting-summary').filter({has:page.getByText(report.meeting.title,{exact:true})}).click();
    await page.getByRole('button',{name:'暂停相册转动',exact:true}).click();
    await page.getByLabel('照片分组').selectOption('7');
    await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    assert.equal(await page.locator('[data-cc-index]').count(),3);
    assert.equal(await page.locator('.memory-counter').innerText(),'57 / 59');
    await page.getByRole('button',{name:'上一张回忆',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    assert.equal(await page.locator('.memory-counter').innerText(),'56 / 59');assert.equal(await page.getByLabel('照片分组').inputValue(),'6');
    await page.getByRole('button',{name:'下一张回忆',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    assert.equal(await page.locator('.memory-counter').innerText(),'57 / 59');
    await page.getByLabel('照片分组').selectOption('0');await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    await page.getByRole('button',{name:'上一张回忆',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
    assert.equal(await page.locator('.memory-counter').innerText(),'59 / 59');
    await page.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();await page.locator('.photo-viewer img').evaluate(image=>image.decode());
    assert.equal((await page.locator('.photo-controls').innerText()).trim(),'5 / 5');
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS persisted local photos, both sessions, private media, stripped metadata and desktop/mobile gallery.');
} finally {await browser.close();}
