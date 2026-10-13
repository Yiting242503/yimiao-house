import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

await mkdir('test-results',{recursive:true});
const result=await build({entryPoints:['src/main.jsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',write:false,outdir:'photo-navigation-fixture',external:['/assets/*'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text,css=result.outputFiles.find(file=>file.path.endsWith('.css')).text;
const worker=await readFile('dist/server/index.js','utf8');
const fixtures=await Promise.all([0,1,2].map(index=>sharp({create:{width:460,height:360,channels:3,background:{r:95+index*35,g:155,b:110+index*20}}}).jpeg().toBuffer()));
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
try {
  for(const width of [1440,390]) {
    const isolated=await mkdtemp(resolve('test-results',`photo-navigation-${width}-`));
    const runtime=new Miniflare({...convertV4MiniflareOptions({modules:true,script:worker,compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-photo-navigation-db'},r2Buckets:{BUCKET:'isolated-photo-navigation-media'},resourcePersistencePath:isolated,bindings:{LOCAL_PREVIEW:'true'}}),host:'127.0.0.1',port:0,cf:false});
    let context,base;
    const server=createServer(async(request,response)=>{
      try {
        if(request.url==='/frontend.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(js);return;}
        if(request.url==='/frontend.css'){response.writeHead(200,{'Content-Type':'text/css'});response.end(css);return;}
        if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/frontend.css"></head><body><div id="root"></div><script type="module" src="/frontend.js"></script></body></html>');return;}
        const chunks=[];for await(const chunk of request)chunks.push(chunk);
        const upstream=await runtime.dispatchFetch(base+request.url,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:Buffer.concat(chunks)});
        response.writeHead(upstream.status,Object.fromEntries(upstream.headers));response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch(error) {response.writeHead(500,{'Content-Type':'text/plain'});response.end(error.message);}
    });
    try {
      await runtime.ready;
      const db=await runtime.getD1Database('DB');
      for(const file of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
      const login=async slot=>{const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'X-House-Request':'1','Content-Type':'application/json',origin:base},body:JSON.stringify({slot})});assert.equal(response.status,200,await response.clone().text());return response.headers.get('set-cookie').split(';')[0];};
      const owner=await login('yiting'),peer=await login('haomiao');
      const api=async(path,method='GET',data,cookie=owner)=>{const response=await fetch(base+'/api'+path,{method,headers:{cookie,...(method==='GET'?{}:{'X-House-Request':'1','Content-Type':'application/json',origin:base})},body:data===undefined?undefined:JSON.stringify(data)});assert.equal(response.status,200,await response.clone().text());return response.json();};
      const house=await api('/house'),meeting=house.meetings.find(item=>item.id==='initial-1'),otherMeeting=house.meetings.find(item=>item.id!==meeting.id);
      assert.ok(otherMeeting);
      const savePhoto=async(index,cookie,meetingId,text,date)=>{const form=new FormData();form.append('file',new Blob([fixtures[index]],{type:'image/jpeg'}),`cross-batch-${index}.jpg`);const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie,'X-House-Request':'1',origin:base},body:form});assert.equal(response.status,200);const file=await response.json(),entry=await api('/entries','POST',{kind:'memory',meetingId,text,date,media:[file.id]},cookie);return {file,entry};};
      const first=await savePhoto(0,owner,meeting.id,'Owner first upload batch',meeting.start),second=await savePhoto(1,peer,meeting.id,'Peer second upload batch',meeting.end),outside=await savePhoto(2,owner,otherMeeting.id,'Excluded other album',otherMeeting.start);
      context=await browser.newContext({viewport:{width,height:1000}});
      await context.addCookies([{name:'house_session',value:owner.slice(owner.indexOf('=')+1),url:base,httpOnly:true,sameSite:'Strict'}]);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);await page.locator('.hotspot').filter({hasText:'一起走过'}).click();
      await page.locator(`.meeting-album[data-meeting-id="${meeting.id}"]`).click();
      const ring=page.locator('.meeting-memory-modal');await ring.waitFor();await ring.locator('.circular-carousel[data-ready]').waitFor();
      const pause=ring.getByRole('button',{name:'暂停相册转动',exact:true});if(await pause.count())await pause.click();
      await ring.locator('.circular-carousel').press('Home');await ring.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
      const detail=page.locator('.modal.wide').filter({has:page.locator('.photo-viewer')});await detail.waitFor();
      const expectPhoto=async(record,counter,own)=>{await page.waitForFunction(id=>document.querySelector('.photo-viewer')?.dataset.mediaId===id,record.file.id);assert.equal(await detail.locator('.photo-viewer').getAttribute('data-entry-id'),record.entry.id);assert.equal(await detail.locator('.photo-counter').innerText(),counter);assert.equal(await detail.getByRole('button',{name:'删除这张照片',exact:true}).count(),own?1:0);};
      await expectPhoto(first,'1 / 2',true);await detail.getByRole('textbox',{name:'回复内容'}).fill('Unsaved reply from first entry');
      await detail.getByRole('button',{name:'下一张',exact:true}).click();await expectPhoto(second,'2 / 2',false);
      assert.equal(await detail.locator('.detail-text').innerText(),'Peer second upload batch');assert.ok((await detail.locator('.modal-heading').innerText()).includes(house.settings.people.haomiao.name));assert.equal(await detail.getByRole('textbox',{name:'回复内容'}).inputValue(),'');assert.equal(await detail.getByRole('button',{name:'编辑我的记录',exact:true}).count(),0);
      await detail.getByRole('button',{name:'上一张',exact:true}).click();await expectPhoto(first,'1 / 2',true);
      await detail.getByRole('button',{name:'下一张',exact:true}).press('ArrowRight');await expectPhoto(second,'2 / 2',false);
      await detail.locator('.modal-heading').getByRole('button',{name:'关闭',exact:true}).click();await ring.waitFor({state:'visible'});assert.equal(await ring.locator('.memory-counter').innerText(),'2 / 2');
      await ring.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();await expectPhoto(second,'2 / 2',false);
      await detail.getByRole('button',{name:'上一张',exact:true}).click();await expectPhoto(first,'1 / 2',true);
      await detail.getByRole('button',{name:'删除这张照片',exact:true}).click();const confirm=page.locator('.confirm-dialog');await confirm.getByRole('button',{name:'移入最近删除',exact:true}).click();await confirm.waitFor({state:'hidden'});
      await page.waitForFunction(id=>document.querySelector('.photo-viewer')?.dataset.mediaId===id,second.file.id);assert.equal(await detail.getByRole('button',{name:'删除这张照片',exact:true}).count(),0);assert.equal(await detail.locator('.photo-counter').count(),0);
      const after=await api('/house');assert.equal(after.recycledMedia.length,1);assert.equal(after.recycledMedia[0].id,first.file.id);assert.equal(after.entries.find(entry=>entry.id===outside.entry.id).media[0].id,outside.file.id);
      await detail.locator('.modal-heading').getByRole('button',{name:'关闭',exact:true}).click();await ring.waitFor({state:'visible'});assert.equal(await ring.locator('.single-meeting-photo img').getAttribute('src'),'/api/media/'+second.file.id);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
      process.stdout.write(`Cross-batch photo navigation passed (${width}px): same-album scope, owner/peer entries, previous/next keyboard, global counter, reply reset, return ring anchor, delete nearest surviving photo.\n`);
    } finally {await context?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));await runtime.dispose();}
  }
} finally {await browser.close();}
