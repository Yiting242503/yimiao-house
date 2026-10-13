import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [input='.wrangler/personalized-room.webp']=process.argv.slice(2);
const base='http://127.0.0.1:5173';
assert.equal(new URL(base).hostname,'127.0.0.1');
const bytes=await readFile(resolve(input)),hash=createHash('sha256').update(bytes).digest('hex');
assert.equal(bytes.subarray(0,4).toString(),'RIFF');
assert.equal(bytes.subarray(8,12).toString(),'WEBP');
assert.ok(bytes.length<8*1024*1024,'Private room artwork must be under 8 MiB.');
const manifestFile=resolve('.wrangler/imports',`room-${hash}.json`);
await mkdir('.wrangler/imports',{recursive:true});
let manifest;
try {manifest=JSON.parse(await readFile(manifestFile,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;manifest={hash,environment:'local-preview-only'};}
const save=()=>writeFile(manifestFile,JSON.stringify(manifest,null,2));
async function login(slot) {
  const response=await fetch(base+'/api/dev-login',{method:'POST',headers:{'Content-Type':'application/json','X-House-Request':'1'},body:JSON.stringify({slot})});
  assert.equal(response.status,200,await response.clone().text());
  const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const session=await (await fetch(base+'/api/session',{headers:{cookie}})).json();
  assert.ok(session.localPreview&&session.authorized&&session.slot===slot,'This importer only supports authenticated local preview.');
  return cookie;
}
const cookie=await login('yiting');
async function api(route,method='GET',data) {
  const response=await fetch(base+'/api'+route,{method,headers:{cookie,'Content-Type':'application/json','X-House-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  if(!response.ok)throw new Error(`${route}: ${await response.text()}`);
  return response.json();
}
const before=await api('/house');
if(manifest.applied && before.settings.roomArt!==manifest.mediaId)throw new Error('The room artwork was subsequently changed; refusing to restore it silently.');
if(!manifest.mediaId) {
  const form=new FormData();form.append('file',new Blob([bytes],{type:'image/webp'}),'private-room.webp');
  const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie,'X-House-Request':'1'},body:form});
  assert.equal(response.status,200,await response.clone().text());manifest.mediaId=(await response.json()).id;await save();
}
assert.equal((await fetch(base+'/api/media/'+manifest.mediaId,{headers:{cookie}})).status,200,'The uploaded illustration must still exist.');
if(before.settings.roomArt!==manifest.mediaId) {
  const fresh=await api('/house');
  await api('/settings','PUT',{...fresh.settings,roomArt:manifest.mediaId});
}
manifest.applied=true;manifest.appliedAt=new Date().toISOString();await save();
const after=await api('/house');
assert.equal(after.settings.roomArt,manifest.mediaId);
assert.deepEqual(after.meetings,before.meetings,'Importing room artwork must not modify meetings.');
assert.deepEqual(after.entries,before.entries,'Importing room artwork must not modify private records.');
const peer=await login('haomiao');
assert.equal((await (await fetch(base+'/api/house',{headers:{cookie:peer}})).json()).settings.roomArt,manifest.mediaId);
for(const viewer of [cookie,peer]) {
  const image=await fetch(base+'/api/media/'+manifest.mediaId,{headers:{cookie:viewer}});
  assert.equal(image.status,200);assert.equal(image.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
}
assert.equal((await fetch(base+'/api/media/'+manifest.mediaId)).status,401);
console.log(JSON.stringify({environment:'local-preview-only',mediaId:manifest.mediaId,bytes:bytes.length,sharedAccounts:2,anonymousStatus:401}));
