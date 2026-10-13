import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';

const base='http://127.0.0.1:5173';
const state=house=>JSON.stringify({settings:house.settings,meetings:house.meetings,entries:house.entries,misses:house.misses});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const results=[];
let longMedia=null,longBytes=null;
const specs=[['desktop',1440,1000,false,false],['mobile',390,844,false,false],['small-mobile',360,800,false,false],['reduced-motion',390,844,true,false],['webgl-fallback',390,844,false,true]];
const canvasScreenshot=async (page,canvas)=>{
  const box=await canvas.boundingBox();
  assert.ok(box&&box.width>0&&box.height>0,'Holo canvas has no bounds');
  return page.screenshot({clip:box});
};
const imageStats=async (page,canvas)=>{
  const buffer=await canvasScreenshot(page,canvas);
  const {data}=await sharp(buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let min=255,max=0;
  for(const value of data){min=Math.min(min,value);max=Math.max(max,value);}
  return {buffer,range:max-min};
};
const waitPhoto=async (page,fallback=false)=>{
  const card=page.locator('.photo-viewer .holo-card');
  await card.waitFor();
  await card.locator('.holo-card__face--front img').evaluate(image=>image.decode());
  await page.waitForFunction(fallback=>{const card=document.querySelector('.photo-viewer .holo-card');return fallback?card?.getAttribute('data-renderer')==='fallback':card?.hasAttribute('data-ready');},fallback);
  return card;
};
const zoomScale=page=>page.locator('.photo-viewer .zoom-photo-frame').evaluate(frame=>Number(frame.dataset.zoom));
const waitScale=async (page,rule,value=1)=>{
  await page.waitForFunction(({rule,value})=>{const scale=Number(document.querySelector('.photo-viewer .zoom-photo-frame')?.dataset.zoom);return rule==='one'?Math.abs(scale-1)<0.001:rule==='gt'?scale>value:scale<value;},{rule,value});
  await page.waitForTimeout(220);
  return zoomScale(page);
};
const resetZoom=async page=>{
  await page.getByRole('button',{name:'还原照片大小',exact:true}).click();
  await waitScale(page,'one');
};
const fineWheel=async (page,deltaY)=>{
  const handled=await page.locator('.photo-viewer .zoom-photo-viewport').evaluate(async (viewport,deltaY)=>{
    const rect=viewport.getBoundingClientRect();
    let handled=0;
    for(let event=0;event<10;event++){
      const wheel=new WheelEvent('wheel',{deltaY,deltaMode:0,ctrlKey:true,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,bubbles:true,cancelable:true});
      if(!viewport.dispatchEvent(wheel))handled++;
      await new Promise(resolve=>setTimeout(resolve,12));
    }
    return handled;
  },deltaY);
  assert.ok(handled===10,'Photo viewport did not handle the trackpad gesture');
  await page.waitForTimeout(220);
  return zoomScale(page);
};
const panPosition=page=>page.locator('.photo-viewer .zoom-photo-content').evaluate(content=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(content).transform);return {x:matrix.m41,y:matrix.m42};});
const dragPhoto=async (page,vertical=false)=>{
  const box=await page.locator('.photo-viewer .zoom-photo-viewport').boundingBox();
  const before=await panPosition(page);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-45,box.y+box.height/2-(vertical?90:25),{steps:8});
  await page.mouse.up();
  await page.waitForTimeout(220);
  const after=await panPosition(page);
  assert.ok(Math.abs(before.x-after.x)>5||Math.abs(before.y-after.y)>5,'Zoomed photo cannot be panned');
};
const pinchPhoto=async (context,page)=>{
  const session=await context.newCDPSession(page);
  try{
    await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const box=await page.locator('.photo-viewer .zoom-photo-viewport').boundingBox();
    const cx=box.x+box.width/2,cy=box.y+box.height/2;
    const points=distance=>[{id:1,x:cx-distance,y:cy,radiusX:7,radiusY:7,force:1},{id:2,x:cx+distance,y:cy,radiusX:7,radiusY:7,force:1}];
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(30)});
    for(let step=1;step<=8;step++){
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(30+step*30/8)});
      await page.waitForTimeout(30);
    }
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const scale=await waitScale(page,'gt',1.6);
    assert.ok(scale<2.5,'A proportional two-finger pinch zoomed excessively');
    assert.ok(await page.evaluate(()=>Math.abs(visualViewport.scale-1)<0.01),'Pinch zoomed the browser rather than the photo');
    return scale;
  }finally{await session.detach();}
};
const selectLongMedia=async (context,images)=>{
  if(longMedia)return;
  const named=images.filter(file=>/screenshot|screen|截屏|截图|聊天/i.test(file.name||''));
  for(const file of (named.length?named:images).slice(0,24)){
    const response=await context.request.get(base+'/api/media/'+file.id);
    if(response.status()!==200)continue;
    const metadata=await sharp(await response.body()).metadata();
    if(metadata.width&&metadata.height&&metadata.width/metadata.height<=0.25){longMedia=file;return;}
  }
  const width=240,height=1680,colors=[[83,132,149],[152,78,117],[127,146,84],[92,106,147]],pixels=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const color=x<20||x>=width-20?[242,246,248]:colors[Math.floor(y/120)%colors.length],offset=(y*width+x)*3;
    pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2];
  }
  longBytes=await sharp(pixels,{raw:{width,height,channels:3}}).png().toBuffer();
  longMedia={id:'qa-holo-browser-only-long-image',type:'image/png',name:'QA vertical fixture'};
};
const closeDetail=async page=>{
  await page.locator('.modal').filter({has:page.locator('.detail-body')}).getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('.detail-body').waitFor({state:'detached'});
};
const closeMeeting=async (page,counter)=>{
  const modal=page.locator('.meeting-memory-modal');
  await modal.waitFor();
  await page.waitForFunction(counter=>document.querySelector('.meeting-memory-modal .memory-counter')?.textContent.trim()===counter,counter);
  assert.ok((await modal.locator('.memory-counter').innerText()).trim()===counter,'Detail close lost the selected carousel position');
  assert.ok(await modal.getByRole('button',{name:'继续相册转动',exact:true}).count()===1,'Restored carousel did not stay paused');
  await modal.getByRole('button',{name:'关闭',exact:true}).click();
  await modal.waitFor({state:'detached'});
};
const lastPhoto=async page=>{
  await page.locator('.circular-carousel').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(()=>{const text=document.querySelector('.memory-counter')?.textContent.trim();const numbers=text?.split('/').map(Number);return numbers?.length===2&&numbers[0]===numbers[1];});
  return (await page.locator('.memory-counter').innerText()).trim();
};
const home=async page=>{
  await page.goto(base);
  await page.locator('.room-image').waitFor();
  await page.locator('.room-image').evaluate(image=>image.decode());
};
const album=async page=>{
  await home(page);
  await page.locator('.hotspot').filter({hasText:'一起走过'}).click();
  await page.locator('.album-grid').waitFor();
};
try{
  await mkdir('test-results',{recursive:true});
  for(const [name,width,height,reduced,noWebgl] of specs){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:reduced?'reduce':'no-preference',hasTouch:width<=390,isMobile:width<=390});
    try{
      const login=await context.request.post(base+'/api/dev-login',{data:{slot:'yiting'},headers:{'X-House-Request':'1',Origin:base}});
      assert.ok(login.status()===200,'Local preview login failed');
      const beforeResponse=await context.request.get(base+'/api/house');
      assert.ok(beforeResponse.status()===200,'Local snapshot failed');
      const before=await beforeResponse.json();
      assert.ok(before.session?.localPreview===true,'QA must run only against the local preview');
      const images=[...new Map(before.entries.flatMap(entry=>entry.media).filter(file=>file.type?.startsWith('image/')).map(file=>[file.id,file])).values()];
      const video=before.entries.flatMap(entry=>entry.media).find(file=>file.type?.startsWith('video/'));
      assert.ok(images.length>=2&&video,'Read-only QA needs existing image/video media');
      await selectLongMedia(context,images);
      const seed=before.entries.find(entry=>entry.kind==='memory');
      const fixtureText='QA browser-only photo scope';
      const fixture={...structuredClone(seed),id:'qa-holo-browser-only-memory',kind:'memory',meeting_id:null,date:'2099-01-01',created:'2099-01-01T00:00:00.000Z',text:fixtureText,status:'published',author:'yiting',media:[images[0],images[1],video],hearts:[],comments:[]};
      const diary={...structuredClone(fixture),id:'qa-holo-browser-only-diary',kind:'diary',text:'QA browser-only diary scope',media:[images[0]],mood:'平静'};
      const longFixture={...structuredClone(fixture),id:'qa-holo-browser-only-long-entry',date:'2098-01-01',created:'2098-01-01T00:00:00.000Z',text:'QA browser-only long photo',media:[longMedia]};
      const house={...structuredClone(before),entries:[fixture,diary,longFixture,...structuredClone(before.entries)]};
      const meeting=before.meetings.find(item=>before.entries.some(entry=>entry.meeting_id===item.id&&entry.media.filter(file=>file.type?.startsWith('image/')).length>1));
      assert.ok(meeting,'Calendar-origin check needs a meeting photo');
      const page=await context.newPage();
      const errors=[],mutations=[];
      page.on('pageerror',error=>errors.push(error.message));
      if(noWebgl)await page.addInitScript(()=>{
        const getContext=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:getContext.call(this,type,...args);};
      });
      await page.route('**/api/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(!['GET','HEAD'].includes(request.method())){mutations.push(request.method()+' '+url.pathname);await route.abort();return;}
        if(url.pathname==='/api/house'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(house)});return;}
        if(longBytes&&url.pathname==='/api/media/'+longMedia.id){await route.fulfill({status:200,contentType:'image/png',body:longBytes});return;}
        await route.continue();
      });
      await album(page);
      assert.ok(await page.locator('.album-grid .holo-card').count()===0,'Album thumbnails gained a HoloCard');
      await page.locator('.album-cover-button').first().click();
      await page.locator('.album-cover-modal').waitFor();
      assert.ok(await page.locator('.album-cover-modal .holo-card').count()===0,'Cover chooser gained a HoloCard');
      assert.ok(await page.locator('.album-cover-modal canvas').count()===0,'Cover chooser gained a canvas');
      await page.locator('.album-cover-modal').getByRole('button',{name:'取消',exact:true}).click();
      await page.locator('.entry-card.memory').filter({hasText:fixtureText}).click();
      let card=await waitPhoto(page,noWebgl);
      await page.mouse.move(0,0);
      assert.ok(await card.getAttribute('data-motion')===(reduced?'reduced':'full'),'Motion state is incorrect');
      const renderer=await card.getAttribute('data-renderer');
      assert.ok(renderer===(noWebgl?'fallback':'webgl'),'Unexpected renderer');
      const box=await card.boundingBox();
      assert.ok(box&&box.width>50&&box.height>50&&box.x>=-1&&box.x+box.width<=width+1,'HoloCard is not fitted to the viewport');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
      const firstSrc=await card.locator('.holo-card__face--front img').getAttribute('src');
      const canvas=card.locator('.holo-card__face--front canvas');
      assert.ok(await card.getAttribute('data-hover-only')!==null,'Photo effect is not restricted to hover');
      await page.waitForTimeout(1000);
      assert.ok(await card.getAttribute('data-active')===null,'Idle photo effect remains active');
      assert.ok(Number(await canvas.evaluate(canvas=>getComputedStyle(canvas).opacity))===0,'Idle photo hides the original behind foil');
      const first=await imageStats(page,canvas);
      await page.waitForTimeout(650);
      const second=await imageStats(page,canvas);
      assert.ok(first.buffer.equals(second.buffer),'Idle original photo keeps moving');
      let range=second.range,pointer=null;
      assert.ok(range>20,'Original photo is blank');
      await page.screenshot({path:'test-results/holo-card-'+name+'.png',fullPage:false});
      if(!noWebgl){
        const pointerBox=await card.boundingBox();
        await page.mouse.move(pointerBox.x+pointerBox.width*.2,pointerBox.y+pointerBox.height*.2);
        await page.waitForTimeout(250);
        assert.ok(await card.getAttribute('data-active')!==null,'Hover does not activate the photo effect');
        assert.ok(Number(await canvas.evaluate(canvas=>getComputedStyle(canvas).opacity))>0.99,'Hover does not show the foil canvas');
        const top=await canvasScreenshot(page,canvas);
        await page.mouse.move(pointerBox.x+pointerBox.width*.8,pointerBox.y+pointerBox.height*.8);
        await page.waitForTimeout(250);
        const bottom=await canvasScreenshot(page,canvas);
        pointer=!top.equals(bottom);
        assert.ok(reduced?!pointer:pointer,reduced?'Reduced-motion effect reacts with motion':'Pointer does not move HoloCard effect');
        assert.ok(!second.buffer.equals(bottom),'Hover foil does not change the original photo');
        range=(await imageStats(page,canvas)).range;
        await page.screenshot({path:'test-results/holo-card-'+name+'-hover.png',fullPage:false});
        await page.mouse.move(0,0);
        assert.ok(await card.getAttribute('data-active')===null,'Leaving the photo keeps the effect active');
        assert.ok(Number(await canvas.evaluate(canvas=>getComputedStyle(canvas).opacity))===0,'Leaving the photo keeps foil visible');
      }else{
        assert.ok(await card.locator('.holo-card__face--front img').evaluate(image=>image.naturalWidth>0),'Fallback image is blank');
        const opacity=await card.locator('.holo-card__face--front canvas').evaluate(canvas=>getComputedStyle(canvas).opacity);
        assert.ok(Number(opacity)===0,'Fallback canvas covers the original photo');
      }
      await waitScale(page,'one');
      const zoomButtons=page.locator('.photo-zoom-controls button');
      assert.ok(await zoomButtons.count()===4,'Zoom toolbar is incomplete');
      if(width<=390)for(const button of await zoomButtons.all()){
        const hit=await button.boundingBox();assert.ok(hit.width>=44&&hit.height>=44,'Mobile zoom control is too small');
      }
      assert.ok(await page.locator('.zoom-photo-viewport').evaluate(viewport=>getComputedStyle(viewport).overflow==='hidden'),'Zoom viewport does not clip enlarged content');
      await page.getByRole('button',{name:'放大照片',exact:true}).click();
      const bigger=await waitScale(page,'gt',1.05);
      assert.ok(parseInt(await page.getByLabel('照片缩放比例',{exact:true}).innerText())>100,'Zoom badge did not increase');
      await page.getByRole('button',{name:'缩小照片',exact:true}).click();
      const smaller=await waitScale(page,'lt',bigger-0.01);
      assert.ok(smaller<bigger,'Zoom-out did not reduce the scale');
      await resetZoom(page);
      await page.getByRole('button',{name:'放大照片',exact:true}).click();
      await waitScale(page,'gt',1.05);
      await page.getByRole('button',{name:'放大照片',exact:true}).click();
      await waitScale(page,'gt',1.4);
      await dragPhoto(page);
      await page.screenshot({path:'test-results/holo-card-'+name+'-zoom.png',fullPage:false});
      await resetZoom(page);
      const viewport=await page.locator('.zoom-photo-viewport').boundingBox();
      await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height/2);
      const trackpadScale=await fineWheel(page,-4);
      assert.ok(trackpadScale>=1.1&&trackpadScale<=1.2,'Small trackpad movements cause excessive photo zoom');
      await fineWheel(page,4);
      await waitScale(page,'one');
      await page.mouse.wheel(0,-100);
      const singleWheelScale=await waitScale(page,'gt',1.01);
      assert.ok(singleWheelScale<=1.31,'A single wheel step causes excessive photo zoom');
      let pinchVerified=false,pinchScale=null;
      if(width<=390){
        await resetZoom(page);
        await page.mouse.move(0,0);
        pinchScale=await pinchPhoto(context,page);
        pinchVerified=true;
      }
      await page.getByRole('button',{name:'下一个附件',exact:true}).click();
      card=await waitPhoto(page,noWebgl);
      await waitScale(page,'one');
      assert.ok(await card.locator('.holo-card__face--front img').getAttribute('src')!==firstSrc,'Next photo kept the previous source');
      await page.getByRole('button',{name:'下一个附件',exact:true}).click();
      assert.ok(await page.locator('.photo-viewer .holo-card').count()===0,'Video received HoloCard effect');
      assert.ok(await page.locator('.photo-viewer video.private-video').count()===1,'Video player disappeared');
      assert.ok(await page.locator('.photo-zoom-controls').count()===0,'Video received photo zoom controls');
      await page.getByRole('button',{name:'下一个附件',exact:true}).click();
      card=await waitPhoto(page,noWebgl);
      await waitScale(page,'one');
      assert.ok(await card.locator('.holo-card__face--front img').getAttribute('src')===firstSrc,'Photo source did not return after the video');
      await page.getByRole('button',{name:'上一个附件',exact:true}).click();
      assert.ok(await page.locator('.photo-viewer .holo-card').count()===0,'Previous video received HoloCard effect');
      await closeDetail(page);
      await page.locator('.album-grid').waitFor();
      await page.locator('.entry-card.memory').filter({hasText:longFixture.text}).click();
      card=await waitPhoto(page,noWebgl);
      await waitScale(page,'one');
      await page.getByRole('button',{name:'照片适合宽度',exact:true}).click();
      await waitScale(page,'gt',1.5);
      const fitted=await card.boundingBox(),longViewport=await page.locator('.zoom-photo-viewport').boundingBox();
      assert.ok(Math.abs(fitted.width-(longViewport.width-32))<4,'Long photo did not fit the viewport width');
      await dragPhoto(page,true);
      await page.screenshot({path:'test-results/holo-card-'+name+'-long-photo.png',fullPage:false});
      await resetZoom(page);
      await closeDetail(page);
      await page.locator('.album-grid').waitFor();
      await album(page);
      await page.locator('.meeting-album[data-meeting-id="'+meeting.id+'"]').click();
      await page.locator('.circular-carousel[data-ready]').waitFor();
      assert.ok(await page.locator('.meeting-memory-modal .holo-card').count()===0,'Carousel thumbnails received HoloCard effect');
      const pause=page.getByRole('button',{name:'暂停相册转动',exact:true});
      if(await pause.count())await pause.click();
      const albumCounter=await lastPhoto(page);
      await page.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
      await waitPhoto(page,noWebgl);
      await closeDetail(page);
      await closeMeeting(page,albumCounter);
      await page.locator('.album-grid').waitFor();
      await home(page);
      await page.locator('.hotspot').filter({hasText:'见面日历'}).click();
      await page.locator('.meeting-summary').filter({has:page.getByText(meeting.title,{exact:true})}).click();
      await page.locator('.circular-carousel[data-ready]').waitFor();
      const calendarPause=page.getByRole('button',{name:'暂停相册转动',exact:true});
      if(await calendarPause.count())await calendarPause.click();
      const calendarCounter=await lastPhoto(page);
      await page.getByRole('button',{name:'打开当前照片与留言',exact:true}).click();
      await page.locator('.photo-viewer>img').evaluate(image=>image.decode());
      assert.ok(await page.locator('.photo-viewer .holo-card').count()===0,'Calendar-origin photo received HoloCard effect');
      await closeDetail(page);
      await closeMeeting(page,calendarCounter);
      await page.locator('.meeting-timeline').waitFor();
      await home(page);
      await page.locator('.hotspot').filter({hasText:'今天的小事'}).click();
      await page.locator('.entry-card.diary').filter({hasText:diary.text}).click();
      await page.locator('.photo-viewer>img').evaluate(image=>image.decode());
      assert.ok(await page.locator('.photo-viewer .holo-card').count()===0,'Diary photo received HoloCard effect');
      await closeDetail(page);
      await page.locator('.entries-list').waitFor();
      assert.ok(errors.length===0,'Browser reported errors: '+errors.join(' | '));
      assert.ok(mutations.length===0,'Read-only UI attempted a data write');
      const after=await (await context.request.get(base+'/api/house')).json();
      assert.ok(state(before)===state(after),'Local private data changed during QA');
      results.push({name,width,height,renderer,range,idleOriginalStable:true,pointer,zoomVerified:true,wheelVerified:true,trackpadScale,singleWheelScale,panVerified:true,pinchVerified,pinchScale,fitWidthVerified:true,longPhotoFixture:longBytes?'browser-only-generated':'existing',scopeCorrect:true,sourceChanged:true,carouselPositionRestored:true,recordsUnchanged:true});
      console.log('PASS '+name+' photo scope, hover, zoom, navigation and unchanged records');
    }catch(error){
      const page=context.pages()[0];
      if(page)await page.screenshot({path:'test-results/holo-card-'+name+'-failure.png',fullPage:false}).catch(()=>{});
      throw error;
    }finally{await context.close();}
  }
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();}
