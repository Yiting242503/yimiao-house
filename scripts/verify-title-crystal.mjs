import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const base='http://127.0.0.1:5173';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try {
  for(const [name,width,height,reduced] of [['desktop',1440,1000,false],['tablet',873,871,false],['mobile',390,844,false],['small-mobile',360,800,false],['reduced-motion',390,844,true]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference'});
    try {
      const login=await context.request.post(base+'/api/dev-login',{data:{slot:'yiting'},headers:{'X-House-Request':'1',Origin:base}});assert.equal(login.status(),200);
      const before=await (await context.request.get(base+'/api/house')).json();
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);await page.locator('.title-crystal[data-crystal-state="ready"]').waitFor();await page.waitForTimeout(2800);
      const crystal=page.locator('.title-crystal'),canvas=crystal.locator('canvas');
      const box=await crystal.boundingBox(),text=await page.locator('.home-title-text').boundingBox();
      assert.ok(box.x>=text.x+text.width-1,'Crystal overlaps the title');assert.ok(box.x+box.width<=width,'Crystal is outside the viewport');
      assert.equal(box.width,width<=760?64:86);
      const first=await canvas.screenshot();await page.waitForTimeout(900);const second=await canvas.screenshot();
      const {data}=await sharp(second).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let min=255,max=0;for(const value of data){min=Math.min(min,value);max=Math.max(max,value);}assert.ok(max-min>15,'Canvas is blank');
      if(reduced)assert.deepEqual(first,second,'Reduced-motion canvas should be still');else assert.ok(!first.equals(second),'Crystal should animate');
      await page.screenshot({path:`test-results/title-crystal-${name}.png`,fullPage:true});
      const documentWidth=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(documentWidth<=width,'Horizontal overflow');
      await page.getByRole('button',{name:'见面日历',exact:true}).first().click();await page.getByRole('button',{name:'回到小屋',exact:true}).click();
      const after=await (await context.request.get(base+'/api/house')).json();
      assert.deepEqual(after.settings,before.settings);assert.deepEqual(after.meetings,before.meetings);assert.deepEqual(after.entries,before.entries);
      assert.deepEqual(errors,[]);results.push({name,width,canvasRange:max-min,animated:!reduced,recordsUnchanged:true});
    }finally{await context.close();}
  }
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();}
