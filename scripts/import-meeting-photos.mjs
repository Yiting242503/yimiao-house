import assert from 'node:assert/strict';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

const [folder,meetingStart,meetingEnd,slot]=process.argv.slice(2);
if(!folder||!meetingStart||!meetingEnd||!['yiting','haomiao'].includes(slot))throw new Error('Usage: node scripts/import-meeting-photos.mjs <folder> <start> <end> <local-slot>');
const root=path.resolve(folder),base='http://127.0.0.1:5173';
const sha=value=>createHash('sha256').update(value).digest('hex');
const login=await fetch(base+'/api/dev-login',{method:'POST',headers:{'Content-Type':'application/json','X-House-Request':'1'},body:JSON.stringify({slot})});
assert.equal(login.status,200,'Local preview login must succeed.');
const cookie=login.headers.get('set-cookie').split(';')[0];
async function api(route,method='GET',data) {
  const response=await fetch(base+'/api'+route,{method,headers:{cookie,'Content-Type':'application/json','X-House-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  if(!response.ok)throw new Error(`${route}: ${await response.text()}`);return response.json();
}
const session=await api('/session');assert.ok(session.localPreview&&session.authorized&&session.slot===slot,'This importer is only for authenticated local preview sessions.');
const house=await api('/house');
const meeting=house.meetings.find(m=>m.start===meetingStart&&m.end===meetingEnd);
assert.ok(meeting,'The exact meeting range must already exist.');
async function scan(directory) {
  const items=await readdir(directory,{withFileTypes:true}),files=[];
  for(const item of items) {
    const file=path.join(directory,item.name);
    if(item.isDirectory())files.push(...await scan(file));
    else if(item.isFile()&&/\.(jpe?g|png|webp)$/i.test(item.name))files.push(file);
  }
  return files;
}
const sourceFiles=(await scan(root)).sort(),unique=[],seen=new Set();
let duplicates=0;
for(const file of sourceFiles) {
  const bytes=await readFile(file),hash=sha(bytes);
  if(seen.has(hash)){duplicates++;continue;}
  seen.add(hash);await sharp(bytes).metadata();unique.push({file,hash});
}
assert.ok(unique.length,'No readable JPG/PNG/WebP photos found.');
const stateDir=path.resolve('.wrangler/imports');await mkdir(stateDir,{recursive:true});
const manifestFile=path.join(stateDir,`${sha(root+'|'+meeting.id+'|'+slot)}.json`);
let manifest;
try {manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;manifest={meetingId:meeting.id,slot,batches:{}};}
const save=()=>writeFile(manifestFile,JSON.stringify(manifest,null,2));
const entryIds=[];
let completed=0;
for(let offset=0;offset<unique.length;offset+=6) {
  const batch=unique.slice(offset,offset+6),key=sha(batch.map(item=>item.hash).join('|'));
  const state=manifest.batches[key]||{requestId:randomUUID(),media:[]};manifest.batches[key]=state;await save();
  if(state.entryId) {
    assert.ok(house.entries.some(e=>e.id===state.entryId),'A previously imported record was deleted; refusing to silently restore it.');
  } else {
    for(let index=state.media.length;index<batch.length;index++) {
      const bytes=await sharp(await readFile(batch[index].file)).rotate().resize(2000,2000,{fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
      const form=new FormData();form.append('file',new Blob([bytes],{type:'image/webp'}),'meeting-photo.webp');
      const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie,'X-House-Request':'1'},body:form});
      if(!response.ok)throw new Error(`Upload failed: ${await response.text()}`);
      state.media.push((await response.json()).id);await save();
    }
    const entry=await api('/entries','POST',{requestId:state.requestId,kind:'memory',status:'published',text:'',date:meeting.start,meetingId:meeting.id,media:state.media});
    state.entryId=entry.id;await save();
  }
  entryIds.push(state.entryId);completed+=batch.length;
  console.log(`Saved ${completed}/${unique.length} photos to the selected meeting.`);
}
const saved=await api('/house');
const imported=saved.entries.filter(e=>entryIds.includes(e.id));
assert.equal(imported.length,entryIds.length);
assert.ok(imported.every(e=>e.meeting_id===meeting.id&&e.author===session.slot));
assert.equal(imported.reduce((count,e)=>count+e.media.length,0),unique.length);
for(const entry of imported)for(const media of entry.media) {
  const response=await fetch(base+`/api/media/${media.id}`,{headers:{cookie}});assert.equal(response.status,200);
}
const report={savedAt:new Date().toISOString(),environment:'local-preview-only',meeting:{id:meeting.id,title:meeting.title,start:meeting.start,end:meeting.end},sourceFiles:sourceFiles.length,photos:unique.length,identicalCopiesSkipped:duplicates,records:entryIds.length,entryIds};
manifest.lastReport=report;await save();
await mkdir('test-results',{recursive:true});await writeFile(`test-results/meeting-${meeting.start}-import.json`,JSON.stringify(report,null,2));
if(meeting.start==='2020-01-01'&&meeting.end==='2020-01-04')await writeFile('test-results/first-meeting-import.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,entryIds:undefined,meeting:{title:meeting.title,start:meeting.start,end:meeting.end}}));
