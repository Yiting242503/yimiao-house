import assert from 'node:assert/strict';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const [folder,start,end,slot]=process.argv.slice(2);
if(!folder||!start||!end||!['yiting','haomiao'].includes(slot))throw new Error('Usage: node scripts/import-meeting-videos.mjs <folder> <start> <end> <local-slot>');
const root=path.resolve(folder),base='http://127.0.0.1:5173';
const sha=value=>createHash('sha256').update(value).digest('hex');
const login=await fetch(base+'/api/dev-login',{method:'POST',headers:{'Content-Type':'application/json','X-House-Request':'1'},body:JSON.stringify({slot})});assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
async function api(route,method='GET',data) {
  const response=await fetch(base+'/api'+route,{method,headers:{cookie,'Content-Type':'application/json','X-House-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  if(!response.ok)throw new Error(`${route}: ${await response.text()}`);return response.json();
}
const session=await api('/session');assert.ok(session.localPreview&&session.authorized&&session.slot===slot,'This importer only supports authenticated local preview.');
const house=await api('/house'),meeting=house.meetings.find(item=>item.start===start&&item.end===end);assert.ok(meeting,'Exact meeting dates must already exist.');
async function scan(directory) {
  const files=[];
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,item.name);
    if(item.isDirectory())files.push(...await scan(file));else if(item.isFile()&&/\.mp4$/i.test(item.name))files.push(file);
  }
  return files;
}
const files=(await scan(root)).sort(),seen=new Set(),entries=[];let duplicates=0;
assert.ok(files.length,'No MP4 videos found.');
await mkdir('.wrangler/imports',{recursive:true});
const manifestFile=path.resolve('.wrangler/imports',`${sha(root+'|'+meeting.id+'|'+slot+'|videos')}.json`);
let manifest;
try {manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;manifest={meetingId:meeting.id,slot,files:{}};}
const save=()=>writeFile(manifestFile,JSON.stringify(manifest,null,2));
for(const file of files) {
  const bytes=await readFile(file),hash=sha(bytes);
  if(seen.has(hash)){duplicates++;continue;}seen.add(hash);
  const state=manifest.files[hash]||{requestId:randomUUID()};manifest.files[hash]=state;await save();
  if(state.entryId)assert.ok(house.entries.some(item=>item.id===state.entryId),'An imported video was deliberately deleted; refusing to restore it silently.');
  else {
    if(!state.mediaId) {
      const form=new FormData();form.append('file',new Blob([bytes],{type:'video/mp4'}),path.basename(file));
      const response=await fetch(base+'/api/upload',{method:'POST',headers:{cookie,'X-House-Request':'1'},body:form});
      if(!response.ok)throw new Error(`Video upload: ${await response.text()}`);state.mediaId=(await response.json()).id;await save();
    }
    const entry=await api('/entries','POST',{requestId:state.requestId,kind:'memory',status:'published',text:'',date:meeting.start,meetingId:meeting.id,media:[state.mediaId]});
    state.entryId=entry.id;await save();
  }
  entries.push(state.entryId);console.log(`Saved ${entries.length} video(s) to ${meeting.title}.`);
}
const saved=await api('/house'),records=saved.entries.filter(item=>entries.includes(item.id));assert.equal(records.length,entries.length);
assert.ok(records.every(item=>item.meeting_id===meeting.id&&item.author===session.slot&&item.media.length===1&&item.media[0].type==='video/mp4'));
const report={completedAt:new Date().toISOString(),environment:'local-preview-only',meeting:{id:meeting.id,title:meeting.title,start,end},sourceFiles:files.length,videos:entries.length,identicalCopiesSkipped:duplicates,entryIds:entries};
manifest.lastReport=report;await save();await mkdir('test-results',{recursive:true});await writeFile(`test-results/meeting-${start}-videos-import.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,entryIds:undefined}));
