import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

await mkdir('test-results',{recursive:true});
const script=await readFile('dist/server/index.js','utf8'),checks=[],errors=[];
const fixtures=await Promise.all(Array.from({length:11},(_,index)=>sharp({create:{width:480,height:400,channels:3,background:{r:100+index*10,g:160-index*7,b:100+index*8}}}).jpeg().toBuffer()));
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
try {
  for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const isolated=await mkdtemp(resolve('test-results',`daily-browser-${label}-`));
    const runtime=new Miniflare({...convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-daily-browser-db'},r2Buckets:{BUCKET:'isolated-daily-browser-media'},resourcePersistencePath:isolated,bindings:{LOCAL_PREVIEW:'true'}}),host:'127.0.0.1',port:0,cf:false});
    let context;
    try {
      const base=(await runtime.ready).origin,db=await runtime.getD1Database('DB');
      for(const file of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
      const login=async slot=>{const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'Content-Type':'application/json','X-House-Request':'1',origin:base},body:JSON.stringify({slot})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
      const owner=await login('yiting'),peer=await login('haomiao');
      const api=async(path,method='GET',data,cookie=owner)=>{const response=await fetch(base+'/api'+path,{method,headers:{cookie,...(method==='GET'?{}:{'X-House-Request':'1','Content-Type':'application/json',origin:base})},body:data===undefined?undefined:JSON.stringify(data)});assert.equal(response.status,200,await response.clone().text());return response.json();};
      const files=[];
      for(let index=0;index<9;index++) {
        const form=new FormData();form.append('file',new Blob([fixtures[index]],{type:'image/jpeg'}),`daily-${index+1}.jpg`);
        const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie:owner,'X-House-Request':'1',origin:base},body:form});assert.equal(response.status,200);files.push(await response.json());
      }
      const saved=await api('/entries','POST',{kind:'memory',text:'Independent daily album fixture',date:'2020-01-01',media:files.map(file=>file.id)}),id=saved.id;
      const meeting=(await api('/house')).meetings.find(item=>item.id==='initial-1');
      const meetingPhoto=new FormData();meetingPhoto.append('file',new Blob([fixtures[0]],{type:'image/jpeg'}),'meeting-parity.jpg');
      const meetingUpload=await fetch(base+'/api/upload',{method:'POST',headers:{cookie:owner,'X-House-Request':'1',origin:base},body:meetingPhoto});assert.equal(meetingUpload.status,200);
      await api('/entries','POST',{kind:'memory',meetingId:meeting.id,text:'Isolated meeting card comparison',date:meeting.start,media:[(await meetingUpload.json()).id]});
      context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
      await context.addCookies([{name:'house_session',value:owner.slice(owner.indexOf('=')+1),url:base,httpOnly:true,sameSite:'Strict'}]);
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      const capture=async name=>page.screenshot({path:`test-results/daily-album-${label}-${name}.png`});
      const readyRing=async ring=>{
        const carousel=ring.locator('.circular-carousel[data-ready]');await carousel.waitFor({state:'visible'});
        await carousel.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
        // A newly mounted eight-photo window completes its 1400 ms rise before capture.
        await page.waitForTimeout(1500);
        assert.ok(await carousel.locator('.circular-carousel__frame').evaluateAll(frames=>frames.some(frame=>Number(getComputedStyle(frame).opacity)>0&&Number(getComputedStyle(frame.closest('.circular-carousel__card')).opacity)>0&&frame.getBoundingClientRect().width>0)));
      };
      const cardPresentation=card=>card.locator('.entry-card-content').evaluate(content=>({
        children:[...content.children].map(node=>({tag:node.tagName,className:node.className})),
        typography:['h3','.entry-meta','.album-meeting-place','.album-authors','.entry-card-bottom'].map(selector=>{
          const style=getComputedStyle(content.querySelector(selector));
          return {fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,display:style.display,marginTop:style.marginTop,marginBottom:style.marginBottom,gap:style.gap};
        })
      }));
      const openAlbum=async()=>{await page.goto(base);await page.locator('.hotspot').filter({hasText:'一起走过'}).click();await page.locator(`.daily-album[data-entry-id="${id}"]`).waitFor();};
      await openAlbum();
      let card=page.locator(`.daily-album[data-entry-id="${id}"]`);
      const meetingCard=page.locator(`.meeting-album[data-meeting-id="${meeting.id}"]`);
      assert.deepEqual(await cardPresentation(card),await cardPresentation(meetingCard));
      assert.equal(await card.locator('.entry-meta').innerText(),'2020.01.01');assert.equal(await card.locator('.album-meeting-place').innerText(),'地点待填写');assert.equal(await card.locator('.album-authors').innerText(),'成员 A');
      assert.equal(await card.locator('xpath=ancestor::article').locator('.album-cover-button svg').getAttribute('class'),await meetingCard.locator('xpath=ancestor::article').locator('.album-cover-button svg').getAttribute('class'));
      await card.locator('xpath=ancestor::article').locator('.daily-album-settings-button').click();
      const editor=page.locator('.daily-album-editor');await editor.waitFor();
      const name=`我们的${label==='mobile'?'日常':'周末'}`;
      await editor.getByRole('textbox',{name:/相册名称/}).fill(name);
      await editor.getByRole('radio',{name:'第 2 张照片',exact:true}).locator('..').click();
      await editor.getByRole('radio',{name:'第 2 张照片',exact:true}).locator('..').locator('img').evaluate(image=>image.decode());await capture('settings');
      await editor.getByRole('button',{name:'保存相册',exact:true}).click();await editor.waitFor({state:'hidden'});
      assert.equal(await card.locator('h3').innerText(),name);assert.equal(await card.locator('img').getAttribute('src'),'/api/media/'+files[1].id);
      const shared=await api('/house','GET',undefined,peer);assert.deepEqual(shared.settings.dailyAlbums[id],{name,cover:files[1].id});assert.equal(shared.entries.find(entry=>entry.id===id).meeting_id,null);
      await openAlbum();card=page.locator(`.daily-album[data-entry-id="${id}"]`);assert.equal(await card.locator('h3').innerText(),name);
      await card.click();const ring=page.locator('.daily-memory-modal');await ring.waitFor();
      await ring.locator('.circular-carousel').waitFor({state:'visible'});
      const pause=ring.getByRole('button',{name:'暂停相册转动',exact:true});if(await pause.count())await pause.click();
      await ring.locator('.circular-carousel').press('End');await page.waitForFunction(()=>document.querySelector('.daily-memory-modal .memory-counter')?.textContent==='9 / 9');
      await readyRing(ring);await capture('ring');await ring.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
      const detail=page.locator('.modal.wide').filter({has:page.locator('.photo-viewer')});await detail.waitFor();
      assert.equal(await detail.locator('.photo-viewer').getAttribute('data-media-id'),files[8].id);
      assert.equal(await detail.locator('.photo-delete-actions>span').count(),0);assert.equal(await detail.getByText('删除后可在「最近删除」中恢复',{exact:true}).count(),0);
      await detail.getByRole('button',{name:'删除这张照片',exact:true}).waitFor();
      await detail.locator('.modal-heading').getByRole('button',{name:'关闭',exact:true}).click();
      await ring.waitFor({state:'visible'});assert.equal(await ring.locator('.memory-counter').innerText(),'9 / 9');
      await ring.getByRole('button',{name:'补充相册照片',exact:true}).click();
      const composer=page.locator('.modal').filter({has:page.locator('.editor-form.editor-fieldset')});await composer.waitFor();
      await composer.locator('input[type="file"][multiple]').setInputFiles(fixtures.slice(9).map((buffer,index)=>({name:`added-${index+1}.jpg`,mimeType:'image/jpeg',buffer})));
      await page.waitForFunction(()=>document.querySelectorAll('.modal .selected-photo').length===11);
      await composer.getByRole('button',{name:'保存到小屋',exact:true}).click();await composer.waitFor({state:'hidden'});
      await ring.waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('.daily-memory-modal .memory-topline')?.textContent.includes('11 张照片'));
      const after=await api('/house'),entry=after.entries.find(entry=>entry.id===id);assert.equal(entry.media.length,11);assert.equal(entry.meeting_id,null);assert.deepEqual(after.settings.dailyAlbums[id],{name,cover:files[1].id});
      assert.deepEqual(entry.media.slice(0,9).map(file=>file.id),files.map(file=>file.id));
      await ring.locator('.circular-carousel').press('End');await page.waitForFunction(()=>document.querySelector('.daily-memory-modal .memory-counter')?.textContent==='11 / 11');await readyRing(ring);await capture('appended');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await ring.locator('.modal-heading').getByRole('button',{name:'关闭',exact:true}).click();
      assert.equal(await page.locator(`.daily-album[data-entry-id="${id}"] h3`).innerText(),name);
      card=page.locator(`.daily-album[data-entry-id="${id}"]`);
      await card.focus();await card.press('Shift+F10');const menu=page.getByRole('menu',{name:'相册操作',exact:true});await menu.waitFor();
      await menu.press('Escape');await menu.waitFor({state:'hidden'});assert.equal(await card.evaluate(node=>document.activeElement===node),true);
      await card.locator('img').click({button:'right'});await menu.waitFor();await menu.getByRole('menuitem',{name:'删除相册',exact:true}).click();
      const dialog=page.locator('.confirm-dialog');await dialog.waitFor();assert.ok((await dialog.innerText()).includes('最近删除'));
      await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});
      const cancelled=await api('/house');assert.deepEqual(cancelled.entries.find(item=>item.id===id).media.map(file=>file.id),entry.media.map(file=>file.id));assert.equal(cancelled.recycledMedia.length,0);
      await card.locator('img').click({button:'right'});await menu.waitFor();await capture('context-menu');await menu.getByRole('menuitem',{name:'删除相册',exact:true}).click();await dialog.waitFor();
      await dialog.getByRole('button',{name:'删除相册',exact:true}).click();await dialog.waitFor({state:'hidden'});await card.waitFor({state:'hidden'});
      const removed=await api('/house');assert.equal(removed.entries.some(item=>item.id===id),false);assert.deepEqual(removed.recycledMedia.filter(file=>file.entry_id===id).map(file=>file.id).sort(),entry.media.map(file=>file.id).sort());assert.deepEqual(removed.settings.dailyAlbums[id],{name,cover:files[1].id});
      assert.equal(removed.entries.filter(item=>item.meeting_id===meeting.id).length,1);assert.equal((await api('/house','GET',undefined,peer)).entries.some(item=>item.id===id),false);
      await page.getByRole('button',{name:'最近删除 (11)',exact:true}).click();await page.locator('.photo-trash').waitFor();assert.equal(await page.locator('.photo-trash-item').count(),11);await capture('album-deleted');
      const restored=page.locator(`.photo-trash-item[data-media-id="${files[0].id}"]`);await restored.getByRole('button',{name:'恢复',exact:true}).click();await restored.waitFor({state:'hidden'});
      await page.getByRole('button',{name:'返回相册',exact:true}).click();await card.waitFor();assert.equal(await card.locator('h3').innerText(),name);assert.equal(await card.locator('img').getAttribute('src'),'/api/media/'+files[0].id);
      const recovered=await api('/house');assert.deepEqual(recovered.entries.find(item=>item.id===id).media.map(file=>file.id),[files[0].id]);assert.deepEqual(recovered.settings.dailyAlbums[id],{name,cover:files[1].id});assert.equal(recovered.recycledMedia.filter(file=>file.entry_id===id).length,10);
      await page.getByRole('button',{name:'最近删除 (10)',exact:true}).click();const trash=page.locator('.photo-trash');await trash.waitFor();
      const batchControls=trash.getByRole('group',{name:'批量整理最近删除',exact:true}),batchDelete=batchControls.getByRole('button',{name:'批量永久删除',exact:true}),trashItem=mediaId=>trash.locator(`.photo-trash-item[data-media-id="${mediaId}"]`);
      assert.equal(await batchDelete.isDisabled(),true);assert.equal(await trash.locator('.photo-trash-item input[type="checkbox"]:checked').count(),0);
      const selectedForPurge=[files[1].id,files[2].id];for(const mediaId of selectedForPurge)await trashItem(mediaId).getByRole('checkbox').check();
      assert.equal(await batchControls.getByRole('status').innerText(),'已选择 2 个附件');await batchDelete.scrollIntoViewIfNeeded();await capture('batch-selected');
      await batchDelete.click();await dialog.waitFor();assert.ok((await dialog.innerText()).includes('2 张照片'));assert.ok((await dialog.innerText()).includes('无法恢复'));
      await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await api('/house')).recycledMedia.length,10);assert.equal(await trash.locator('.photo-trash-item input[type="checkbox"]:checked').count(),2);
      let failedOnce=false;const retryUrl=base+'/api/media/'+selectedForPurge[1]+'/permanent';
      await page.route(retryUrl,async route=>{if(!failedOnce){failedOnce=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Isolated batch retry fixture'})});}else await route.continue();});
      await batchDelete.click();await dialog.waitFor();await dialog.getByRole('button',{name:'批量永久删除',exact:true}).click();
      // AlertDialog hides the outside status region from the accessibility tree while it remains open for retry.
      await page.locator('.toast').filter({hasText:'1 个附件已永久删除，1 个未完成。'}).waitFor();assert.equal(failedOnce,true);
      const partial=await api('/house');assert.equal(partial.recycledMedia.length,9);assert.equal(partial.recycledMedia.some(file=>file.id===selectedForPurge[0]),false);assert.equal(partial.recycledMedia.some(file=>file.id===selectedForPurge[1]),true);
      assert.equal(await trashItem(selectedForPurge[1]).locator('input[type="checkbox"]').isChecked(),true);assert.equal(await trash.locator('.photo-trash-item input[type="checkbox"]:checked').count(),1);await capture('batch-retry');
      await dialog.getByRole('button',{name:'批量永久删除',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.unroute(retryUrl);
      const purged=await api('/house');assert.deepEqual(purged.recycledMedia.map(file=>file.id).sort(),recovered.recycledMedia.filter(file=>!selectedForPurge.includes(file.id)).map(file=>file.id).sort());assert.equal(purged.recycledMedia.length,8);
      for(const mediaId of selectedForPurge)assert.equal((await fetch(base+'/api/media/'+mediaId,{headers:{cookie:owner}})).status,404);
      assert.equal(await trash.locator('.photo-trash-item input[type="checkbox"]:checked').count(),0);assert.equal(await batchDelete.isDisabled(),true);
      await batchControls.getByRole('checkbox',{name:'全选',exact:true}).check();assert.equal(await trash.locator('.photo-trash-item input[type="checkbox"]:checked').count(),8);assert.equal(await batchControls.getByRole('status').innerText(),'已选择 8 个附件');await capture('batch-select-all');
      await batchDelete.click();await dialog.waitFor();assert.ok((await dialog.innerText()).includes('8 张照片'));await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await api('/house')).recycledMedia.length,8);
      await batchControls.getByRole('button',{name:'清空选择',exact:true}).click();assert.equal(await trash.locator('.photo-trash-item input[type="checkbox"]:checked').count(),0);assert.equal(await batchDelete.isDisabled(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      checks.push(`${label}: daily/meeting cards and cover icons match; shared name/cover persist; photo hint removed; ring renders and preserves selection; adding two photos retains one eleven-photo album; keyboard and right-click menus work; album deletion cancellation preserves files and confirmation moves eleven to trash; restoring one recovers the album name; batch purge cancellation preserves ten files; a simulated partial failure removes only its success and retains the failed selection for retry; retry permanently removes exactly the two selected files; all eight remaining files can be selected and cleared without deleting.`);console.log('PASS '+checks.at(-1));
    } finally {if(context)await context.close();await runtime.dispose();}
  }
  assert.deepEqual(errors,[]);
  await writeFile('test-results/daily-album-verification.json',JSON.stringify({scope:'Isolated generated fixtures only',checks,errors},null,2));
} finally {await browser.close();}
