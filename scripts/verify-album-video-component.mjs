import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AlbumVideos from './src/components/AlbumVideos/AlbumVideos.jsx';
import { useVideoPlaying } from './src/components/PrivateVideo.jsx';
const entry={id:'fixture-entry',author:'yiting',date:'2026-10-12'};
const videos=['a','b','c'].map((id,photoIndex)=>({file:{id,type:'video/mp4',name:id+'.mp4'},entry,photoIndex}));
function Fixture(){
  const [version,setVersion]=useState(1),[order,setOrder]=useState(['c','invalid','c','a']),[sortable,setSortable]=useState(true);
  const playing=useVideoPlaying();
  return <main style={{maxWidth:680,margin:'auto',padding:20}}><output id="video-active">{playing?'playing':'idle'}</output><button id="refresh" onClick={()=>setVersion(value=>value+1)}>Refresh fixture</button><button id="filter" onClick={()=>setSortable(value=>!value)}>Filter fixture</button><AlbumVideos videos={videos} savedOrder={order} people={{yiting:{name:'Fixture'}}} refreshKey={version} sortable={sortable} onOpen={()=>{window.openedVideo=true;}} onSave={async ids=>{window.savedVideoOrder=ids;setOrder(ids);setVersion(value=>value+1);return true;}}/></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const result = await build({stdin:{contents:fixture,resolveDir:process.cwd(),sourcefile:'album-video-fixture.jsx',loader:'jsx'},bundle:true,platform:'browser',format:'esm',jsx:'automatic',write:false,outdir:'fixture-build',logLevel:'error'});
const js = result.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css = (await readFile('src/style.css','utf8'))+'\n'+result.outputFiles.find(file=>file.path.endsWith('.css')).text;
let media = Buffer.alloc(0), browser;
const server = createServer((request,response)=>{
  if(request.url.startsWith('/api/media/')){response.writeHead(200,{'Content-Type':'video/webm','Cache-Control':'no-store'});response.end(media);}
  else if(request.url==='/fixture.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(js);}
  else if(request.url==='/fixture.css'){response.writeHead(200,{'Content-Type':'text/css'});response.end(css);}
  else {response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
  const seed=await browser.newPage();
  await seed.goto(`http://127.0.0.1:${server.address().port}`);
  const recorded=await seed.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;canvas.getContext('2d').fillRect(0,0,160,100);
    const stream=canvas.captureStream(10), recorder=new MediaRecorder(stream,{mimeType:'video/webm'}), chunks=[];
    const paint=setInterval(()=>{const context=canvas.getContext('2d');context.fillStyle=Date.now()%2?'#5f6a55':'#bc816d';context.fillRect(0,0,160,100);},50);
    const ready=new Promise(resolve=>{recorder.ondataavailable=event=>chunks.push(event.data);recorder.onstop=async()=>{clearInterval(paint);const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());stream.getTracks().forEach(track=>track.stop());resolve(btoa(String.fromCharCode(...bytes)));};});
    recorder.start();setTimeout(()=>recorder.stop(),1400);return ready;
  });
  media=Buffer.from(recorded,'base64');await seed.close();
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:900},...(width===390?{isMobile:true,hasTouch:true,deviceScaleFactor:3,userAgent:'Mozilla/5.0 (Linux; Android 12; HUAWEI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50'}:{})}), errors=[], mediaRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('/api/media/'))mediaRequests.push(new URL(request.url()).pathname+new URL(request.url()).search);});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const ids=()=>page.locator('[data-video-id]').evaluateAll(cards=>cards.map(card=>card.dataset.videoId));
    await page.locator('[data-video-id]').first().waitFor();assert.deepEqual(await ids(),['c','a','b']);
    assert.equal(await page.locator('video[controls]').count(),3);
    assert.equal(await page.locator('video').evaluateAll(players=>players.every(player=>player.preload==='none')),true);
    assert.deepEqual(mediaRequests,[]);
    await page.locator('[data-video-id="c"] video').evaluate(async video=>{video.loop=true;await video.play();});
    await page.waitForFunction(()=>document.querySelector('#video-active').textContent==='playing');
    assert.ok(mediaRequests.includes('/api/media/c?variant=stream'));
    await page.locator('[data-video-id="c"] video').evaluate(video=>{video.currentTime=.4;});
    await page.locator('[data-video-id="a"]').getByRole('button',{name:'继续播放a.mp4'}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-video-id="a"] video').paused);
    assert.equal(await page.locator('[data-video-id="c"] video').getAttribute('src'),null);
    assert.equal(await page.locator('[data-video-id="c"] video').evaluate(video=>video.paused),true);
    assert.equal(await page.locator('#video-active').textContent(),'playing');
    await page.locator('[data-video-id="c"]').getByRole('button',{name:'继续播放c.mp4'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-video-id="c"] video').currentTime>=.35);
    assert.equal(await page.locator('[data-video-id="a"] video').getAttribute('src'),null);
    await page.locator('[data-video-id="a"]').getByRole('button',{name:'继续播放a.mp4'}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-video-id="a"] video').paused);
    await page.locator('[data-video-id="a"]').getByRole('button',{name:'切换原画视频'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-video-id="a"] video').getAttribute('src')==='/api/media/a');
    assert.ok(mediaRequests.includes('/api/media/a'));
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
    assert.equal(await page.locator('[data-video-id="a"] video').getAttribute('src'),null);
    assert.equal(await page.locator('#video-active').textContent(),'idle');
    await page.locator('[data-video-id="a"]').getByRole('button',{name:'继续播放a.mp4'}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-video-id="a"] video').paused);
    await page.locator('[data-video-id="a"]').getByRole('button',{name:'打开视频与留言'}).click();
    await page.waitForFunction(()=>window.openedVideo===true);
    assert.equal(await page.locator('video').evaluateAll(players=>players.every(player=>player.paused&&!player.hasAttribute('src'))),true);
    assert.equal(await page.locator('#video-active').textContent(),'idle');
    // Native controls and mode transitions are verified independently of media decoding.
    await page.locator('[data-video-id="c"] video').dblclick({position:{x:20,y:20}});
    await page.locator('.album-videos.sorting').waitFor();
    assert.equal(await page.locator('video[controls]').count(),0);
    assert.equal(await page.locator('video').evaluateAll(videos=>videos.every(video=>video.paused)),true);
    await page.locator('[data-video-id="c"]').getByRole('button',{name:'下移c.mp4',exact:true}).click();
    assert.deepEqual(await ids(),['a','c','b']);
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await ids(),['c','a','b']);
    await page.getByRole('button',{name:'调整视频顺序',exact:true}).click();
    await page.locator('[data-video-id="b"]').getByRole('button',{name:'拖动b.mp4调整顺序'}).focus();await page.keyboard.press('Home');
    assert.deepEqual(await ids(),['b','c','a']);
    await page.getByRole('button',{name:'保存顺序',exact:true}).click();
    await page.waitForFunction(()=>window.savedVideoOrder?.join(',')==='b,c,a');assert.deepEqual(await ids(),['b','c','a']);
    assert.equal(await page.locator('video[controls]').count(),3);
    await page.getByRole('button',{name:'调整视频顺序',exact:true}).click();
    await page.locator('[data-video-id="a"]').getByRole('button',{name:'拖动a.mp4调整顺序'}).dragTo(page.locator('[data-video-id="b"] .album-video-sort-overlay'));
    assert.deepEqual(await ids(),['a','b','c']);
    await page.getByRole('button',{name:'保存顺序',exact:true}).click();await page.waitForFunction(()=>window.savedVideoOrder?.join(',')==='a,b,c');
    if(width===390){
      await page.getByRole('button',{name:'调整视频顺序',exact:true}).click();
      const source=page.locator('[data-video-id="a"] .album-video-drag-handle');await source.scrollIntoViewIfNeeded();
      const sourceBox=await source.boundingBox(), targetBox=await page.locator('[data-video-id="b"] .album-video-sort-overlay').boundingBox();
      const touch=await page.context().newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sourceBox.x+sourceBox.width/2,y:sourceBox.y+sourceBox.height/2}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:targetBox.x+20,y:targetBox.y+20}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.deepEqual(await ids(),['b','a','c']);
      await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await touch.detach();
      await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await ids(),['a','b','c']);
    }
    await page.getByRole('button',{name:'调整视频顺序',exact:true}).click();await page.locator('#refresh').click();
    await page.getByText('相册已更新，请取消后重新调整顺序。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存顺序',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'取消',exact:true}).click();await page.locator('#filter').click();assert.equal(await page.getByRole('button',{name:'调整视频顺序',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
    await page.close();process.stdout.write(`AlbumVideos browser verification passed (${width}px): stream/original playback, one player at a time, released old downloads, detail pause, native controls, sort, keyboard, drag, cancel/save, stale guard, filtered scope.\n`);
  }
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
