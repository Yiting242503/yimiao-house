import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const checks=[],pageErrors=[],consoleErrors=[],screenshots=[],states=[];
const script=await readFile('dist/server/index.js','utf8');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const mark=message=>{checks.push(message);console.log('PASS '+message);};
await mkdir('test-results',{recursive:true});
const jpegFixtures=await Promise.all(['#b97565','#809c9e'].map(background=>sharp({create:{width:600,height:480,channels:3,background}}).jpeg({quality:85}).toBuffer()));
const batchJpegFixtures=await Promise.all(['#af6464','#d28b59','#c5aa66','#7d9a6c','#5d999e','#6881a4','#9c789f','#8d7970'].map(background=>sharp({create:{width:320,height:240,channels:3,background}}).jpeg({quality:85}).toBuffer()));
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let browser,failure;

async function waitForSnapshot(read,predicate,message) {
  for(let attempt=0;attempt<100;attempt++) {
    const value=await read();if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw new Error(message);
}

try {
  browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
  for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const isolatedState=await mkdtemp(resolve('test-results',`photo-trash-browser-${label}-`));states.push(isolatedState);
    const runtime=new Miniflare({...convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-browser-trash-db'},r2Buckets:{BUCKET:'isolated-browser-trash-media'},resourcePersistencePath:isolatedState,bindings:{LOCAL_PREVIEW:'true'}}),host:'127.0.0.1',port:0,cf:false});
    let context,page;
    try {
      const base=new URL(await runtime.ready).origin;
      const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
      for(const file of (await readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
      async function api(cookie,path,method='GET',data) {
        const response=await fetch(base+'/api'+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='GET'||method==='HEAD'?{}:{'X-House-Request':'1',origin:base,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
        assert.equal(response.status,200,`${method} ${path}: ${await response.clone().text()}`);return response.json();
      }
      async function login(slot) {
        const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'X-House-Request':'1',origin:base,'Content-Type':'application/json'},body:JSON.stringify({slot})});
        assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
      }
      const owner=await login('yiting'),peer=await login('haomiao'),state=()=>api(owner,'/house');
      const before=await state();assert.equal(before.session.localPreview,true);assert.equal(before.meetings.length,14);assert.equal(before.entries.length,0);
      const meeting=before.meetings.find(item=>item.id==='initial-1'),files=[];
      for(let index=0;index<jpegFixtures.length;index++) {
        const form=new FormData();form.append('file',new Blob([jpegFixtures[index]],{type:'image/jpeg'}),`${label}-recovery-${index+1}.jpg`);
        const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie:owner,'X-House-Request':'1',origin:base},body:form});
        assert.equal(response.status,200,await response.clone().text());files.push(await response.json());
      }
      const entry=await api(owner,'/entries','POST',{kind:'memory',meetingId:meeting.id,date:meeting.start,text:`Isolated ${label} recovery fixture`,media:files.map(file=>file.id)});
      await api(peer,`/entries/${entry.id}/comments`,'POST',{text:'Preserve the original reply'});
      await api(peer,`/entries/${entry.id}/heart`,'POST',{});
      const original=(await state()).entries.find(item=>item.id===entry.id),originalOrder=original.media.map(file=>file.id);
      const bytesById=new Map(files.map((file,index)=>[file.id,jpegFixtures[index]]));
      async function verifyBytesAndOrder(expectedIds) {
        const current=(await state()).entries.find(item=>item.id===entry.id);
        assert.deepEqual(current?.media.map(file=>file.id)??[],expectedIds);
        if(current){assert.deepEqual(current.comments,original.comments);assert.deepEqual(current.hearts,original.hearts);assert.equal(current.meeting_id,meeting.id);}
        for(const id of expectedIds) {
          const response=await fetch(base+'/api/media/'+id,{headers:{cookie:owner}});assert.equal(response.status,200);
          assert.equal(digest(Buffer.from(await response.arrayBuffer())),digest(bytesById.get(id)));
        }
      }
      context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
      await context.addCookies([{name:'house_session',value:owner.slice(owner.indexOf('=')+1),url:base,httpOnly:true,sameSite:'Strict'}]);
      page=await context.newPage();page.on('pageerror',error=>pageErrors.push({label,message:error.message}));
      page.on('console',message=>{if(message.type()==='error')consoleErrors.push({label,message:message.text()});});
      const grid=()=>page.locator(`.meeting-album[data-meeting-id="${meeting.id}"]`);
      const meetingModal=()=>page.locator('.meeting-memory-modal');
      const detail=()=>page.locator('.modal').filter({has:page.locator('.photo-viewer')});
      const item=id=>page.locator(`.photo-trash-item[data-media-id="${id}"]`);
      async function capture(phase) {
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label} ${phase}: horizontal overflow`);
        const path=resolve('test-results',`photo-trash-${label}-${phase}.png`);await page.screenshot({path,fullPage:true});screenshots.push(path);
      }
      async function openAlbum() {
        await page.goto(base);await page.getByRole('heading',{name:'意淼小屋',exact:true}).waitFor();
        await page.locator('.room-image').evaluate(image=>image.decode());
        await page.locator('.hotspot').filter({hasText:'一起走过'}).click();await grid().waitFor();
      }
      async function openCurrentPhoto() {
        await grid().click();await meetingModal().waitFor();
        const single=meetingModal().getByRole('button',{name:'打开这次见面的照片',exact:true});
        if(await single.count())await single.click();
        else {
          const pause=meetingModal().getByRole('button',{name:'暂停相册转动',exact:true});if(await pause.count())await pause.click();
          await page.waitForFunction(()=>document.querySelector('.circular-carousel')?.hasAttribute('data-ready'));
          await meetingModal().getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
        }
        await detail().waitFor();await detail().locator('.photo-viewer img').first().evaluate(image=>image.decode());
        const src=await detail().locator('.photo-viewer img').first().getAttribute('src');assert.ok(src?.startsWith('/api/media/'));
        return src.split('/').at(-1);
      }
      async function moveCurrentToTrash() {
        await detail().getByRole('button',{name:'删除这张照片',exact:true}).click();
        const dialog=page.locator('.confirm-dialog');await dialog.waitFor();assert.ok((await dialog.innerText()).includes('恢复'));
        await dialog.getByRole('button',{name:'移入最近删除',exact:true}).click();await dialog.waitFor({state:'hidden'});
      }
      async function openTrash(expectedCount) {
        if(await detail().count())await detail().getByRole('button',{name:'关闭',exact:true}).click();
        if(await meetingModal().count())await meetingModal().getByRole('button',{name:'关闭',exact:true}).click();
        const button=page.getByRole('button',{name:`最近删除 (${expectedCount})`,exact:true});await button.waitFor();await button.click();await page.locator('.photo-trash').waitFor();
        assert.equal(await page.locator('.photo-trash-item').count(),expectedCount);
      }
      async function restoreInTrash(id) {
        await item(id).getByRole('button',{name:'恢复',exact:true}).click();await item(id).waitFor({state:'hidden'});
      }

      await openAlbum();const selectedId=await openCurrentPhoto(),siblingId=files.find(file=>file.id!==selectedId).id;
      await detail().getByRole('button',{name:'删除这张照片',exact:true}).click();
      const softDialog=page.locator('.confirm-dialog');await softDialog.waitFor();await softDialog.getByRole('button',{name:'保留',exact:true}).click();await softDialog.waitFor({state:'hidden'});
      await verifyBytesAndOrder(originalOrder);assert.equal((await state()).recycledMedia.length,0);
      await moveCurrentToTrash();await waitForSnapshot(state,value=>value.recycledMedia.some(file=>file.id===selectedId),'Single photo did not reach trash');
      await page.waitForFunction(id=>document.querySelector('.photo-viewer img')?.getAttribute('src')===`/api/media/${id}`,siblingId);
      await verifyBytesAndOrder([siblingId]);await capture('sibling-remains');
      assert.equal((await fetch(base+'/api/media/'+selectedId,{headers:{cookie:peer}})).status,404);
      await openTrash(1);assert.equal(await item(selectedId).locator('img').count(),1);await capture('recently-deleted');
      await restoreInTrash(selectedId);await verifyBytesAndOrder(originalOrder);
      await page.getByRole('button',{name:'返回相册',exact:true}).click();await grid().waitFor();await capture('restored');
      mark(`${label}: cancel keeps both original photos; delete keeps the sibling; trash restoration preserves photo bytes, order, meeting, comments and hearts.`);

      const firstId=await openCurrentPhoto();await moveCurrentToTrash();
      await waitForSnapshot(state,value=>value.entries.find(item=>item.id===entry.id)?.media.length===1,'First photo did not reach trash');
      const lastId=files.find(file=>file.id!==firstId).id;
      await page.waitForFunction(id=>document.querySelector('.photo-viewer img')?.getAttribute('src')===`/api/media/${id}`,lastId);
      await moveCurrentToTrash();await waitForSnapshot(state,value=>!value.entries.some(item=>item.id===entry.id),'Empty memory remains visible');
      await meetingModal().locator('.meeting-memory-empty').waitFor();await capture('empty-album');
      await openTrash(2);await restoreInTrash(firstId);await verifyBytesAndOrder([firstId]);await restoreInTrash(lastId);await verifyBytesAndOrder(originalOrder);
      await page.getByRole('button',{name:'返回相册',exact:true}).click();await grid().waitFor();
      mark(`${label}: deleting the final photo returns to the empty meeting; each photo restores into the original memory.`);

      const permanentId=await openCurrentPhoto(),remainingId=files.find(file=>file.id!==permanentId).id;
      const stored=await db.prepare('SELECT key FROM media WHERE id=?').bind(permanentId).first();
      await moveCurrentToTrash();await waitForSnapshot(state,value=>value.recycledMedia.some(file=>file.id===permanentId),'Photo did not reach trash before permanent deletion');
      await openTrash(1);await item(permanentId).getByRole('button',{name:'永久删除',exact:true}).click();
      const permanentDialog=page.locator('.confirm-dialog');await permanentDialog.waitFor();assert.ok((await permanentDialog.innerText()).includes('无法再恢复'));
      await permanentDialog.getByRole('button',{name:'取消',exact:true}).click();await permanentDialog.waitFor({state:'hidden'});
      assert.notEqual(await bucket.head(stored.key),null);assert.equal(await item(permanentId).count(),1);
      await item(permanentId).getByRole('button',{name:'永久删除',exact:true}).click();await permanentDialog.waitFor();
      await permanentDialog.getByRole('button',{name:'永久删除',exact:true}).click();await permanentDialog.waitFor({state:'hidden'});await item(permanentId).waitFor({state:'hidden'});
      assert.equal(await db.prepare('SELECT id FROM media WHERE id=?').bind(permanentId).first(),null);assert.equal(await bucket.head(stored.key),null);assert.equal(await bucket.get(stored.key),null);
      for(const cookie of [owner,peer])assert.equal((await fetch(base+'/api/media/'+permanentId,{headers:{cookie}})).status,404);
      await verifyBytesAndOrder([remainingId]);await capture('permanently-deleted');
      await page.getByRole('button',{name:'返回相册',exact:true}).click();await grid().waitFor();await capture('final-album');
      assert.equal((await state()).meetings.length,before.meetings.length);
      mark(`${label}: cancelling permanent deletion keeps recovery possible; confirming removes only the chosen R2 object and metadata while its sibling remains.`);

      await page.getByRole('button',{name:'添一张回忆',exact:true}).click();
      const composer=page.locator('.modal').filter({has:page.locator('.editor-form')});await composer.waitFor();
      const batchText=`Isolated ${label} eight-photo batch`;
      await composer.getByRole('textbox',{name:'留下一句话',exact:true}).fill(batchText);
      await composer.getByLabel('关联一次见面').selectOption(meeting.id);
      await composer.locator('input[type="file"][multiple]').setInputFiles(batchJpegFixtures.map((buffer,index)=>({name:`${label}-batch-${index+1}.jpg`,mimeType:'image/jpeg',buffer})));
      await page.waitForFunction(()=>document.querySelectorAll('.editor-form .selected-photo').length===8);
      assert.ok((await composer.locator('.photo-picker-note').innerText()).includes('已选 8 / 100'));await capture('batch-selected');
      // Preserve the real API flow while making the sequential progress visible long enough to inspect.
      await page.route('**/api/upload',async route=>{await new Promise(resolve=>setTimeout(resolve,60));await route.continue();});
      const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/entries'&&response.request().method()==='POST');
      await composer.getByRole('button',{name:'保存到小屋',exact:true}).click();await composer.locator('.upload-progress').waitFor();await capture('batch-uploading');
      const batchResponse=await saved;assert.equal(batchResponse.status(),200,await batchResponse.text());await composer.waitFor({state:'hidden'});await page.unroute('**/api/upload');
      const batch=(await state()).entries.find(item=>item.text===batchText);assert.ok(batch);assert.equal(batch.media.length,8);assert.equal(new Set(batch.media.map(file=>file.id)).size,8);
      assert.deepEqual(batch.media.map(file=>file.name),batchJpegFixtures.map((_,index)=>`${label}-batch-${index+1}.webp`));
      for(const file of batch.media)assert.equal((await fetch(base+'/api/media/'+file.id,{headers:{cookie:peer}})).status,200);
      await capture('batch-saved');mark(`${label}: one file selection previews and saves all eight distinct photos with visible upload progress and no truncation.`);
    } catch(error) {
      if(page)try {const path=resolve('test-results',`photo-trash-${label}-failure.png`);await page.screenshot({path,fullPage:true});screenshots.push(path);}catch{}
      throw error;
    } finally {if(context)await context.close();await runtime.dispose();}
  }
  assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);mark('Both viewports have no browser runtime errors, console errors or horizontal overflow.');
} catch(error) {failure=error;}
finally {
  if(browser)await browser.close();
  await writeFile('test-results/photo-trash-browser-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),passed:!failure,scope:'Fresh isolated Miniflare D1/R2 states and generated fixture JPEGs only; no real .wrangler data used.',checks,pageErrors,consoleErrors,screenshots,states,...(failure?{failure:{name:failure.name,message:failure.message,stack:failure.stack}}:{})},null,2));
}
if(failure)throw failure;
