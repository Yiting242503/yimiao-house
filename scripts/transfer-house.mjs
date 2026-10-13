import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

console.log('Ready for private house transfer JSON on stdin (input is hidden).');
const input=await new Promise((resolve,reject)=>{
  const raw=process.stdin.isTTY&&typeof process.stdin.setRawMode==='function';
  if(raw)process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');let buffer='';
  const cleanup=()=>{process.stdin.off('data',receive);if(raw)process.stdin.setRawMode(false);process.stdin.pause();};
  const receive=chunk=>{if(chunk.includes('\x03')){cleanup();reject(new Error('Transfer cancelled'));return;}buffer+=chunk;if(!/[\r\n]/.test(buffer))return;cleanup();try{resolve(JSON.parse(buffer.trim()));}catch(error){reject(error);}};
  process.stdin.on('data',receive);process.stdin.resume();
});
const {backup,origin,transferKey,platformToken,python,memberBindings}=input;
const siteUrl=new URL(origin);
if(siteUrl.protocol!=='https:'||siteUrl.pathname!=='/'||siteUrl.search||siteUrl.hash||siteUrl.username||siteUrl.password||typeof transferKey!=='string'||transferKey.length<32)throw new Error('Invalid transfer configuration');
const source=JSON.parse(await readFile(resolve(backup,'manifest.json'),'utf8'));
const headers={'X-House-Transfer-Key':transferKey,...(platformToken?{'OAI-Sites-Authorization':'Bearer '+platformToken}:{})};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext(),page=await context.newPage();

async function request(path,options={}) {
  if(new URL(page.url()).origin!==siteUrl.origin)throw new Error('Transfer browser left the configured origin');
  const binary=Buffer.isBuffer(options.body);
  const response=await page.evaluate(async({path,method,headers,body,binary,origin})=>{
    if(location.origin!==origin)throw new Error('Transfer origin changed');
    const target=new URL(path,location.origin);
    if(target.origin!==location.origin||!target.pathname.startsWith('/api/house-transfer'))throw new Error('Invalid transfer path');
    let payload=body;
    if(binary){const decoded=atob(body);payload=new Uint8Array(decoded.length);for(let index=0;index<decoded.length;index++)payload[index]=decoded.charCodeAt(index);}
    const result=await fetch(target.pathname+target.search,{method,headers,...(payload===undefined?{}:{body:payload}),credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(120000)});
    return {status:result.status,ok:result.ok,body:await result.text()};
  },{path:'/api/house-transfer'+path,method:options.method??'GET',headers:{...headers,...options.headers},body:binary?options.body.toString('base64'):options.body,binary,origin:siteUrl.origin});
  if(!response.ok)throw new Error('Transfer '+response.status+': '+response.body.slice(0,500));
  return JSON.parse(response.body);
}

function unchanged() {
  const checked=spawnSync(python,[resolve('scripts/export-house-transfer.py'),backup,'--check'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
  if(checked.status!==0)throw new Error(checked.stderr||checked.stdout||'Source consistency check failed');
}

try {
  unchanged();
  const landing=await page.goto(siteUrl.origin+'/',{waitUntil:'domcontentloaded',timeout:60000});
  if(landing?.status()!==200||new URL(page.url()).origin!==siteUrl.origin)throw new Error('The normal browser could not open the configured house origin');
  const status=await request('');
  if(!status.committed&&(status.counts?.entries||status.counts?.media))throw new Error('Online memories already exist; refusing to replace them');
  let cursor=0,completed=0;
  const workers=Array.from({length:4},async()=>{
    while(cursor<source.objects.length) {
      const file=source.objects[cursor++],bytes=await readFile(file.path);
      if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('A private backup file changed');
      let last;
      for(let attempt=0;attempt<3;attempt++)try {
        await request('/object?key='+encodeURIComponent(file.key),{method:'PUT',headers:{'Content-Type':file.type,'X-House-Content-SHA256':file.sha256},body:bytes});last=null;break;
      }catch(error){last=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
      if(last)throw last;
      completed++;if(completed%25===0||completed===source.objects.length)console.log('Private media copied: '+completed+'/'+source.objects.length);
    }
  });
  const results=await Promise.allSettled(workers);
  const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  unchanged();
  const result=await request('/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,tables:source.tables,memberBindings})});
  console.log(JSON.stringify({copied:completed,...result}));
}finally{await browser.close();}
